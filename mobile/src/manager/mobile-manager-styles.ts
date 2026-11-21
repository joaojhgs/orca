import { StyleSheet } from 'react-native'
import { colors, radii, spacing, typography } from '../theme/mobile-theme'

export const managerStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgBase },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md },
  title: { flex: 1, fontSize: typography.titleSize, fontWeight: '600', color: colors.textPrimary },
  icon: { padding: spacing.sm },
  controller: {
    paddingHorizontal: spacing.lg,
    color: colors.textSecondary,
    fontSize: typography.metaSize
  },
  content: { padding: spacing.lg, gap: spacing.lg },
  section: { gap: spacing.sm },
  text: { color: colors.textPrimary, fontSize: typography.bodySize },
  meta: { color: colors.textSecondary, fontSize: typography.metaSize },
  error: { color: colors.statusRed, fontSize: typography.bodySize },
  row: {
    padding: spacing.md,
    borderRadius: radii.row,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    gap: spacing.xs
  },
  selected: { backgroundColor: colors.bgRaised, borderColor: colors.textSecondary },
  input: {
    padding: spacing.md,
    minHeight: 100,
    textAlignVertical: 'top',
    borderRadius: radii.input,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    color: colors.textPrimary,
    fontSize: typography.bodySize
  },
  search: { minHeight: 44 },
  button: {
    padding: spacing.md,
    alignItems: 'center',
    borderRadius: radii.button,
    borderWidth: 1,
    borderColor: colors.borderSubtle
  },
  primary: { backgroundColor: colors.surfaceBright },
  primaryText: { color: colors.bgBase, fontSize: typography.bodySize, fontWeight: '600' },
  disabled: { opacity: 0.5 },
  message: {
    gap: spacing.sm,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle
  },
  choiceList: { maxHeight: 220 },
  choiceContent: { gap: spacing.sm }
})
