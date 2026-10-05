import type { ArtifactCloudService } from './artifact-cloud-service'
import type { ArtifactHostingStatus } from '../../shared/artifacts'

export type ArtifactService = Pick<
  ArtifactCloudService,
  'list' | 'getPublishedLink' | 'share' | 'publish' | 'update' | 'unshare' | 'delete'
> & {
  hostingStatus?: () => Promise<ArtifactHostingStatus>
}
