import * as Haptics from "expo-haptics";
import type { ReactNode } from "react";
import { ActivityIndicator, Platform, Pressable, Text, TextInput, View, type TextInputProps } from "react-native";

/** Small shared UI kit in the Surette palette (tailwind.config.js). */

/** Display serif: Georgia on iOS/web, the system serif on Android. */
export const serif = { fontFamily: Platform.select({ ios: "Georgia", android: "serif", default: "Georgia, serif" }) };

export function haptic(kind: "light" | "success" | "error" = "light") {
  if (Platform.OS === "web") return;
  if (kind === "light") void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  else void Haptics.notificationAsync(kind === "success" ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error);
}

export function Button({
  title,
  onPress,
  variant = "primary",
  disabled,
  loading,
  icon,
}: {
  title: string;
  onPress: () => void;
  variant?: "primary" | "outline" | "ghost" | "gold" | "danger";
  disabled?: boolean;
  loading?: boolean;
  icon?: ReactNode;
}) {
  const base = "h-12 flex-row items-center justify-center gap-2 rounded-full px-5";
  const styles = {
    primary: "bg-ink dark:bg-ink-dark",
    gold: "bg-gold dark:bg-gold-dark",
    outline: "border border-line dark:border-line-dark",
    ghost: "",
    danger: "bg-danger dark:bg-danger-dark",
  }[variant];
  const text = variant === "outline" || variant === "ghost" ? "text-ink dark:text-ink-dark" : "text-paper dark:text-paper-dark";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled || loading) }}
      onPressIn={() => haptic("light")}
      onPress={onPress}
      disabled={disabled || loading}
      className={`${base} ${styles} ${disabled ? "opacity-40" : ""} active:opacity-80`}
    >
      {loading ? <ActivityIndicator color={variant === "outline" || variant === "ghost" ? undefined : "#fff"} /> : icon}
      <Text className={`text-[15px] font-semibold ${text}`}>{title}</Text>
    </Pressable>
  );
}

export function Field({ label, error, hint, ...input }: TextInputProps & { label: string; error?: string; hint?: string }) {
  return (
    <View className="gap-1.5">
      <Text className="text-[13px] font-medium text-ink2 dark:text-ink2-dark">{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor="#8C8579"
        className={`min-h-12 rounded-xl border bg-paper px-3.5 text-[16px] text-ink dark:bg-paper-dark dark:text-ink-dark ${error ? "border-danger dark:border-danger-dark" : "border-line dark:border-line-dark"}`}
        {...input}
      />
      {error ? <Text className="text-[13px] text-danger dark:text-danger-dark">{error}</Text> : hint ? <Text className="text-[13px] text-ink3 dark:text-ink3-dark">{hint}</Text> : null}
    </View>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <View className="gap-1.5">
      <Text className="text-[13px] font-medium text-ink2 dark:text-ink2-dark">{label}</Text>
      <View className="flex-row flex-wrap gap-2" accessibilityRole="radiogroup" accessibilityLabel={label}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <Pressable
              key={o.value}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              onPress={() => {
                haptic();
                onChange(o.value);
              }}
              className={`rounded-full border px-3.5 py-2 ${on ? "border-ink bg-ink dark:border-ink-dark dark:bg-ink-dark" : "border-line dark:border-line-dark"}`}
            >
              <Text className={`text-[14px] ${on ? "text-paper dark:text-paper-dark" : "text-ink dark:text-ink-dark"}`}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <View className={`rounded-3xl border border-line bg-paper p-5 dark:border-line-dark dark:bg-paper-dark ${className}`}>{children}</View>;
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <Text style={serif} className="text-[22px] text-ink dark:text-ink-dark" accessibilityRole="header">{children}</Text>;
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <Text className="text-[11px] font-semibold uppercase tracking-[2px] text-gold dark:text-gold-dark">{children}</Text>;
}

export const STATUS_LABEL: Record<string, string> = { draft: "Draft", active: "Active", pending: "Under contract", sold: "Sold", off_market: "Off market" };
