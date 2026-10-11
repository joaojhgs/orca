import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { PickerModal } from '../components/PickerModal'
import { colors, radii, spacing, typography } from '../theme/mobile-theme'

export function NotificationPolicyChoice<Value extends string>({
  label,
  value,
  options,
  disabled,
  onChange
}: {
  label: string
  value: Value
  options: readonly { value: Value; label: string }[]
  disabled?: boolean
  onChange: (value: Value) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled }}
        disabled={disabled}
        style={notificationPolicyStyles.row}
        onPress={() => setOpen(true)}
      >
        <Text style={notificationPolicyStyles.label}>{label}</Text>
        <Text style={notificationPolicyStyles.detail}>
          {options.find((row) => row.value === value)?.label ?? value}
        </Text>
      </Pressable>
      <PickerModal
        visible={open && !disabled}
        title={label}
        options={[...options]}
        selected={value}
        onSelect={onChange}
        onClose={() => setOpen(false)}
      />
    </View>
  )
}

export const notificationPolicyStyles = StyleSheet.create({
  section: { marginTop: spacing.xl, gap: spacing.sm },
  panel: { backgroundColor: colors.bgPanel, borderRadius: radii.card, overflow: 'hidden' },
  row: { padding: spacing.md, gap: spacing.xs },
  toggle: { padding: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  label: { color: colors.textPrimary, fontSize: typography.bodySize, fontWeight: '500' },
  detail: { color: colors.textMuted, fontSize: typography.metaSize },
  input: {
    color: colors.textPrimary,
    fontSize: typography.bodySize,
    backgroundColor: colors.bgRaised,
    borderRadius: radii.input,
    padding: spacing.md
  },
  primary: {
    backgroundColor: colors.surfaceBright,
    borderRadius: radii.button,
    padding: spacing.md,
    alignItems: 'center'
  },
  primaryText: { color: colors.bgBase, fontSize: typography.bodySize, fontWeight: '600' },
  secondary: { padding: spacing.md, alignItems: 'center' },
  disabled: { opacity: 0.5 }
})
