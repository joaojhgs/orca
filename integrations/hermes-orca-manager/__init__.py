"""Supported Hermes plugin surfaces; no core patches or credential borrowing."""
from .memory_llm import serve_memory_llm


def register(ctx):
    from .manager_tools import register_manager_tools
    register_manager_tools(ctx)

    def setup(parser):
        subcommands = parser.add_subparsers(dest="orca_manager_command", required=True)
        subcommands.add_parser("memory-llm", help="Serve the authenticated loopback memory LLM bridge")
        subcommands.add_parser("prepare-memory", help="Prepare private local Hindsight settings without activating them")
        subcommands.add_parser("memory-test", help="Validate authenticated local retain, semantic recall and reflection")
        subcommands.add_parser("run", help="Consume durable scoped events and supervise owned Runs")
        objective = subcommands.add_parser("objective", help="Queue one operator-authored objective idempotently")
        objective.add_argument("--request-id", required=True)
        objective.add_argument("--workspace-id", required=True)
        objective.add_argument("--objective", required=True)

    def command(args):
        if args.orca_manager_command == "memory-llm":
            serve_memory_llm(ctx)
        elif args.orca_manager_command == "prepare-memory":
            from .prepare_memory import prepare_memory
            prepare_memory()
        elif args.orca_manager_command == "memory-test":
            from .smoke_memory_api import smoke_memory_api
            smoke_memory_api()
        elif args.orca_manager_command == "run":
            from .manager_adapter import run_adapter
            run_adapter(ctx)
        elif args.orca_manager_command == "objective":
            from .manager_state import open_manager_state
            state = open_manager_state()
            try:
                if not 1 <= len(args.objective.strip()) <= 32000 or not 1 <= len(args.workspace_id) <= 4096:
                    raise ValueError("Objective input exceeds its budget")
                state.enqueue_objective(args.request_id, args.workspace_id, args.objective)
                print("Operator objective queued; Orca still decides grant admission")
            finally:
                state.db.close()

    ctx.register_cli_command(
        name="orca-manager",
        help="Run scoped Orca manager integration services",
        setup_fn=setup,
        handler_fn=command,
    )
