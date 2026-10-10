"""Translate Hindsight's memory-only function format to one host-owned JSON call.

No tools execute here or in Hermes. Hindsight executes its own memory queries.
"""
import json
import uuid

MEMORY_FUNCTIONS = {"response", "search_mental_models", "search_observations", "recall", "expand", "done"}


def complete_memory_tools(ctx, payload, options):
    tools = payload["tools"]
    if not isinstance(tools, list) or not 1 <= len(tools) <= len(MEMORY_FUNCTIONS):
        raise ValueError("Invalid memory function schema list")
    definitions = {}
    for tool in tools:
        if not isinstance(tool, dict) or set(tool) != {"type", "function"} or tool["type"] != "function":
            raise ValueError("Only memory function schemas are accepted")
        function = tool["function"]
        if (not isinstance(function, dict) or set(function) - {"name", "description", "parameters", "strict"}
                or function.get("name") not in MEMORY_FUNCTIONS
                or not isinstance(function.get("parameters"), dict)
                or function["name"] in definitions):
            raise ValueError("Unknown or invalid memory function")
        definitions[function["name"]] = function
    if payload.get("parallel_tool_calls", False) is not False:
        raise ValueError("Parallel memory function selection is disabled")
    messages = payload.get("messages")
    if not isinstance(messages, list) or not 1 <= len(messages) <= 100:
        raise ValueError("A bounded memory message list is required")
    for message in messages:
        if (not isinstance(message, dict) or set(message) - {"role", "content", "tool_calls", "tool_call_id"}
                or message.get("role") not in {"system", "user", "assistant", "tool"}
                or not (isinstance(message.get("content"), str) or
                        message.get("role") == "assistant" and message.get("content") is None)):
            raise ValueError("Invalid memory function history")
        for call in message.get("tool_calls", []):
            if (not isinstance(call, dict) or set(call) - {"id", "type", "function"}
                    or call.get("type") != "function" or not isinstance(call.get("function"), dict)
                    or call["function"].get("name") not in MEMORY_FUNCTIONS
                    or not isinstance(call["function"].get("arguments"), str)):
                raise ValueError("Invalid memory-only function history")
    choice = payload.get("tool_choice", "auto")
    if isinstance(choice, dict):
        if set(choice) != {"type", "function"} or choice["type"] != "function" or not isinstance(choice["function"], dict) or set(choice["function"]) != {"name"}:
            raise ValueError("Invalid named memory selection")
        forced = choice["function"]["name"]
        if forced not in definitions:
            raise ValueError("Selected memory function was not declared")
    elif choice in {"required", "auto", "none"}:
        forced = next(iter(definitions)) if choice == "required" and len(definitions) == 1 else None
    else:
        raise ValueError("Unsupported memory selection mode")
    description = json.dumps({"conversation": messages, "memoryFunctions": list(definitions.values())}, ensure_ascii=False)
    if forced:
        schema = definitions[forced]["parameters"]
        instructions = f"Follow the conversation and return only JSON arguments for the memory function {forced}. Do not execute tools."
    else:
        variants = [{"type": "object", "additionalProperties": False,
                     "properties": {"name": {"type": "string", "enum": [name]}, "arguments": value["parameters"]},
                     "required": ["name", "arguments"]} for name, value in definitions.items()]
        schema = {"type": "object", "additionalProperties": False,
                  "properties": {"calls": {"type": "array", "minItems": 1 if choice == "required" else 0,
                                           "maxItems": 0 if choice == "none" else 1, "items": {"anyOf": variants}},
                                 "text": {"type": "string"}}, "required": ["calls", "text"]}
        instructions = "Follow the conversation. Select at most one declared memory function and JSON arguments, or return final text. Do not execute tools."
    result = ctx.llm.complete_structured(instructions=instructions,
                                         input=[{"type": "text", "text": description}],
                                         json_mode=True, json_schema=schema, **options)
    parsed = result.parsed if result.parsed is not None else json.loads(result.text)
    calls = [{"name": forced, "arguments": parsed}] if forced else parsed["calls"]
    if (not isinstance(calls, list) or len(calls) > 1 or choice == "required" and not calls
            or choice == "none" and calls):
        raise ValueError("Unconfirmed memory function selection")
    converted = []
    for call in calls:
        if call.get("name") not in definitions or not isinstance(call.get("arguments"), dict):
            raise ValueError("Unconfirmed memory function arguments")
        converted.append({"id": "call_" + uuid.uuid4().hex, "type": "function",
                          "function": {"name": call["name"], "arguments": json.dumps(call["arguments"], ensure_ascii=False)}})
    message = {"role": "assistant", "content": None if forced else parsed["text"]}
    if converted:
        message["tool_calls"] = converted
    return result, message, "tool_calls" if converted else "stop"
