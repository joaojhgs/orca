import { createElement, useEffect } from 'react'
import { act, create } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { MobileManagerConversations } from './use-mobile-manager-conversations'
import { FakeLogicalClient, FakeSession } from '../transport/mobile-endpoint-supervisor-test-fakes'

const mocks = vi.hoisted(() => ({
  params: vi.fn(),
  host: vi.fn(),
  manager: vi.fn(),
  back: vi.fn()
}))
vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  KeyboardAvoidingView: 'KeyboardAvoidingView',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  Platform: { OS: 'android' },
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 }
}))
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }))
vi.mock('expo-router', () => ({
  useLocalSearchParams: mocks.params,
  useRouter: () => ({ back: mocks.back }),
  useFocusEffect: (callback: () => void | (() => void)) => useEffect(callback, [callback])
}))
vi.mock('lucide-react-native', () => ({ ChevronLeft: 'ChevronLeft' }))
vi.mock('../transport/client-context', () => ({ useHostClient: mocks.host }))
vi.mock('../components/MobileMarkdown', () => ({ MobileMarkdown: 'MobileMarkdown' }))
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {} }))
vi.mock('./use-mobile-manager-conversations', () => ({
  useMobileManagerConversations: mocks.manager
}))
import { MobileManagerScreen } from './MobileManagerScreen'
import { managerReceiptOwnerKey } from './mobile-manager-request-store'

function managerState(): MobileManagerConversations {
  return {
    catalog: {
      conversations: [],
      nextOffset: null,
      principals: [
        {
          id: 'hermes',
          label: 'Hermes worker',
          createdAt: 0,
          expiresAt: 9999999999999,
          actions: ['run:create'],
          state: 'active',
          consumerConnected: false
        }
      ]
    },
    detail: null,
    runId: null,
    workspaces: [{ id: 'folder:project', label: 'Project · ssh:worker' }],
    pending: null,
    recoveryReady: true,
    busy: false,
    error: null,
    notice: null,
    refresh: vi.fn(async () => true),
    select: vi.fn(),
    moreConversations: vi.fn(async () => true),
    loadMore: vi.fn(async () => true),
    loadWorkspaces: vi.fn(async () => true),
    retry: vi.fn(async () => true),
    create: vi.fn(async () => true),
    send: vi.fn(async () => true)
  }
}

describe('native Manager screen', () => {
  let client: RpcClient
  let state: MobileManagerConversations
  let renderer: ReturnType<typeof create> | null
  beforeEach(() => {
    vi.clearAllMocks()
    client = new FakeSession('connected')
    state = managerState()
    mocks.params.mockReturnValue({ hostId: 'controller-a', runId: undefined })
    mocks.host.mockImplementation(() => ({
      client,
      clientId: 'private-pairing-a',
      state: client.getState()
    }))
    mocks.manager.mockImplementation(() => state)
    renderer = null
  })
  afterEach(() => {
    if (renderer) {
      act(() => renderer?.unmount())
    }
  })
  function render() {
    act(() => {
      renderer = create(createElement(MobileManagerScreen))
    })
    if (!renderer) {
      throw new Error('Screen did not mount')
    }
    return renderer
  }

  it('binds the exact route controller and deep-linked objective without exposing a pairing token', () => {
    mocks.params.mockReturnValue({
      hostId: ['controller-a', 'controller-b'],
      runId: 'run-deeplink'
    })
    const view = render()
    expect(mocks.host).toHaveBeenCalledWith('controller-a')
    expect(mocks.manager).toHaveBeenLastCalledWith(
      client,
      expect.objectContaining({
        ownerKey: managerReceiptOwnerKey('controller-a', 'private-pairing-a')
      }),
      true,
      'run-deeplink'
    )
    expect(JSON.stringify(view.toJSON())).toContain('controller-a')
    expect(JSON.stringify(view.toJSON())).not.toContain('private-pairing-a')
  })

  it('requires explicit manager and SSH/folder workspace choices before an objective can be sent', () => {
    const view = render()
    const button = () => view.root.findByProps({ accessibilityLabel: 'Send objective' })
    expect(button().props.disabled).toBe(true)
    act(() => {
      view.root.findByProps({ accessibilityLabel: 'Hermes worker' }).props.onPress()
      view.root.findByProps({ accessibilityLabel: 'Project · ssh:worker' }).props.onPress()
      view.root
        .findByProps({ accessibilityLabel: 'Manager objective' })
        .props.onChangeText('Build this project')
    })
    expect(button().props.disabled).toBe(false)
    act(() => button().props.onPress())
    expect(state.create).toHaveBeenCalledWith('hermes', 'folder:project', 'Build this project')
  })

  it('blocks duplicates while offering an explicit saved-request retry', () => {
    state.pending = {
      kind: 'create',
      requestId: 'request-1',
      principalId: 'hermes',
      workspaceId: 'folder:project',
      objective: 'Build'
    }
    const view = render()
    expect(view.root.findByProps({ accessibilityLabel: 'Manager objective' }).props.editable).toBe(
      false
    )
    act(() => view.root.findByProps({ accessibilityLabel: 'Retry saved request' }).props.onPress())
    expect(state.retry).toHaveBeenCalledTimes(1)
    expect(state.create).not.toHaveBeenCalled()
  })

  it('lets a human answer an exact recorded question, clearing only an acknowledged composer', async () => {
    state.runId = 'run-1'
    state.detail = {
      run: { id: 'run-1', objective: 'Build project' },
      principalId: 'hermes',
      nextSequence: 1,
      hasMore: false,
      messages: [
        {
          id: 'question-1',
          runId: 'run-1',
          sequence: 1,
          role: 'manager',
          kind: 'question',
          body: 'Which approach?',
          replyTo: null,
          createdAt: 'now'
        }
      ]
    }
    const view = render()
    act(() => view.root.findByProps({ accessibilityLabel: 'Answer question 1' }).props.onPress())
    const composer = () => view.root.findByProps({ accessibilityLabel: 'Answer manager question' })
    act(() => composer().props.onChangeText('Use approach A'))
    await act(async () =>
      view.root.findByProps({ accessibilityLabel: 'Send answer' }).props.onPress()
    )
    expect(state.send).toHaveBeenCalledWith('Use approach A', 'question-1')
    expect(view.root.findByProps({ accessibilityLabel: 'Message manager' }).props.value).toBe('')
  })

  it('keeps revoked manager history visible without allowing more messages', () => {
    state.runId = 'run-1'
    state.detail = {
      run: { id: 'run-1', objective: 'Read-only objective' },
      principalId: 'hermes',
      messages: [],
      nextSequence: 0,
      hasMore: false
    }
    if (!state.catalog?.principals[0]) {
      throw new Error('Missing principal')
    }
    state.catalog.principals[0].state = 'revoked'
    const view = render()
    expect(JSON.stringify(view.toJSON())).toContain('History is read-only')
    expect(view.root.findByProps({ accessibilityLabel: 'Message manager' }).props.editable).toBe(
      false
    )
    expect(view.root.findByProps({ accessibilityLabel: 'Send message' }).props.disabled).toBe(true)
  })

  it('rebinds the surface after a connected-to-connected transport migration', async () => {
    const logical = new FakeLogicalClient('connected', 'lan')
    client = logical
    render()
    mocks.manager.mockClear()
    await act(async () => {
      await logical.migrateTo(new FakeSession('connected'), 'relay')
    })
    expect(mocks.manager).toHaveBeenCalled()
    expect(mocks.manager.mock.calls.at(-1)?.[0]).toBe(logical)
  })

  it('fails closed when no controller is selected or only a page placeholder is available', () => {
    mocks.params.mockReturnValue({})
    mocks.host.mockReturnValue({ client: null, clientId: null, state: 'disconnected' })
    const view = render()
    expect(mocks.manager).not.toHaveBeenCalled()
    expect(JSON.stringify(view.toJSON())).toContain('Saved requests remain')
    mocks.params.mockReturnValue({ hostId: 'controller-a' })
    mocks.host.mockReturnValue({ client, clientId: 'orca-page-client', state: 'connected' })
    act(() => view.update(createElement(MobileManagerScreen)))
    expect(mocks.manager).not.toHaveBeenCalled()
    expect(JSON.stringify(view.toJSON())).toContain('native pairing identity')
  })
})
