import { join } from 'node:path'
import type {
  ArtifactCloudOperation,
  ArtifactCloudOptions,
  ArtifactHostingStatus,
  ArtifactListItem,
  ArtifactListOptions,
  ArtifactListPage,
  ArtifactPublishedLink,
  ArtifactPublishResult,
  ArtifactWriteRequest
} from '../../shared/artifacts'
import { assertArtifactSharingAllowed } from '../../shared/artifact-sharing-gate'
import { ensureActiveOrcaProfile } from '../orca-profiles/profile-index-store'
import { LocalArtifactStore, localArtifactItem } from './local-artifact-store'
import { LOCAL_ARTIFACT_DATABASE, LocalArtifactViewer } from './local-artifact-viewer'

export class LocalArtifactService {
  private readonly viewer: LocalArtifactViewer

  constructor(
    private readonly userDataPath: string,
    private readonly isSharingEnabled: () => boolean,
    options: { bindHost: string; port: number; publicOrigin?: string }
  ) {
    if (options.publicOrigin) {
      const url = new URL(options.publicOrigin)
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.pathname !== '/' ||
        url.search ||
        url.hash
      ) {
        throw new Error('Local artifact viewer URL must be an HTTP(S) origin')
      }
      options = { ...options, publicOrigin: url.origin }
    }
    this.viewer = new LocalArtifactViewer(userDataPath, options)
  }

  async hostingStatus(): Promise<ArtifactHostingStatus> {
    const profile = ensureActiveOrcaProfile(this.userDataPath)
    return {
      backend: 'local',
      identity: `local:${profile.profile.id}`,
      requiresCloudLogin: false,
      supportsPdf: true,
      sharingEnabled: this.isSharingEnabled(),
      viewerOrigin: await this.viewer.start()
    }
  }

  dispose(): Promise<void> {
    return this.viewer.close()
  }

  private async withStore<T>(
    action: (store: LocalArtifactStore, origin: string, profileId: string) => T
  ): Promise<ArtifactCloudOperation<T>> {
    const profile = ensureActiveOrcaProfile(this.userDataPath)
    const origin = await this.viewer.start()
    if (ensureActiveOrcaProfile(this.userDataPath).profile.id !== profile.profile.id) {
      throw new Error('Active artifact profile changed')
    }
    const store = new LocalArtifactStore(join(profile.profileDirectory, LOCAL_ARTIFACT_DATABASE))
    try {
      return { status: 'ok', value: action(store, origin, profile.profile.id) }
    } finally {
      store.close()
    }
  }

  list(options: ArtifactListOptions): Promise<ArtifactCloudOperation<ArtifactListPage>> {
    return this.withStore((store, origin, profileId) => {
      const records = store.list(options.cursor)
      return {
        artifacts: records
          .slice(0, 50)
          .map((record) => localArtifactItem(record, origin, profileId)),
        ...(records.length > 50 ? { nextCursor: records[49]!.slug } : {})
      }
    })
  }

  getPublishedLink(
    request: ArtifactCloudOptions & { sourceKey: string }
  ): Promise<ArtifactCloudOperation<ArtifactPublishedLink | null>> {
    return this.withStore((store, origin, profileId) => {
      const record = store.bySource(request.sourceKey)
      return record ? { shareUrl: localArtifactItem(record, origin, profileId).shareUrl } : null
    })
  }

  publish(request: ArtifactWriteRequest): Promise<ArtifactCloudOperation<ArtifactPublishResult>> {
    assertArtifactSharingAllowed(this.isSharingEnabled)
    return this.withStore((store, origin, profileId) => {
      const result = store.write(request, false)
      return { change: result.change, item: localArtifactItem(result.record, origin, profileId) }
    })
  }

  async share(request: ArtifactWriteRequest): Promise<ArtifactCloudOperation<ArtifactListItem>> {
    const result = await this.publish(request)
    return result.status === 'ok' ? { status: 'ok', value: result.value.item } : result
  }

  update(request: ArtifactWriteRequest): Promise<ArtifactCloudOperation<ArtifactListItem>> {
    assertArtifactSharingAllowed(this.isSharingEnabled)
    return this.withStore((store, origin, profileId) =>
      localArtifactItem(store.write(request, true).record, origin, profileId)
    )
  }

  unshare(
    request: ArtifactCloudOptions & { sourceKey: string }
  ): Promise<ArtifactCloudOperation<void>> {
    return this.withStore((store) => {
      const record = store.bySource(request.sourceKey)
      if (record) {
        store.delete(record.slug)
      }
    })
  }

  delete(id: string, _options: ArtifactCloudOptions): Promise<ArtifactCloudOperation<void>> {
    return this.withStore((store) => store.delete(id))
  }
}
