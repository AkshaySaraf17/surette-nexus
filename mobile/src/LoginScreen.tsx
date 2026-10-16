import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, ApiError, getApiUrl, type User } from "./api";
import { Button, Eyebrow, Field, haptic, serif } from "./ui";

/** Team sign-in (admins and agents). Clients use the website. */
export function LoginScreen({ onSignedIn, notice }: { onSignedIn: (token: string, user: User) => void; notice?: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState(notice ?? "");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setErrors({});
    setMessage("");
    try {
      const { token, user } = await api.login(email.trim(), password);
      if (user.role === "client") {
        setMessage("This app is for the Surette team. Clients can use the website.");
        haptic("error");
        return;
      }
      haptic("success");
      onSignedIn(token, user);
    } catch (err) {
      haptic("error");
      if (err instanceof ApiError) {
        setErrors(err.fields);
        setMessage(err.message);
      } else setMessage("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-ivory dark:bg-ivory-dark">
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1">
        <ScrollView contentContainerClassName="flex-grow justify-center px-6 py-10" keyboardShouldPersistTaps="handled">
          <Text style={serif} className="text-[30px] tracking-[6px] text-ink dark:text-ink-dark">SURETTE</Text>
          <View className="mt-2"><Eyebrow>Team app</Eyebrow></View>
          <Text style={serif} className="mt-8 text-[34px] leading-[38px] text-ink dark:text-ink-dark">List a home from the driveway.</Text>
          <Text className="mt-3 text-[15px] text-ink2 dark:text-ink2-dark">Photos and details you upload here appear on the website within seconds.</Text>
          <View className="mt-10 gap-4">
            <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="username" error={errors.email} />
            <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" textContentType="password" error={errors.password} onSubmitEditing={submit} returnKeyType="go" />
            {message ? <Text className="text-[14px] text-danger dark:text-danger-dark" accessibilityLiveRegion="polite">{message}</Text> : null}
            <Button title="Sign in" onPress={submit} loading={busy} disabled={!email || !password} />
          </View>
          <Text className="mt-8 text-center text-[12px] text-ink3 dark:text-ink3-dark">Server: {getApiUrl()}</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
