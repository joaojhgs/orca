import type { ReactNode } from 'react'
import { Pressable, Text } from 'react-native'
import { managerStyles as styles } from './mobile-manager-styles'

export function ManagerButton(props: {
  children: ReactNode
  onPress: () => void
  disabled?: boolean
  primary?: boolean
  label?: string
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        props.label ?? (typeof props.children === 'string' ? props.children : undefined)
      }
      accessibilityState={{ disabled: Boolean(props.disabled) }}
      disabled={props.disabled}
      onPress={props.onPress}
      style={[styles.button, props.primary && styles.primary, props.disabled && styles.disabled]}
    >
      <Text style={props.primary ? styles.primaryText : styles.text}>{props.children}</Text>
    </Pressable>
  )
}
