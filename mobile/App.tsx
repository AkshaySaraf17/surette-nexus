import "./global.css";

import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { api, ApiError, setSessionToken, tokenStore, type User } from "./src/api";
import { CalendarClock, HomeIcon, LogOut } from "./src/icons";
import { ListingEditor } from "./src/ListingEditor";
import { ListingsScreen } from "./src/ListingsScreen";
import { LoginScreen } from "./src/LoginScreen";
import { ShowingsScreen } from "./src/ShowingsScreen";
import { haptic } from "./src/ui";

type Session = { status: "booting" } | { status: "signedOut"; notice?: string } | { status: "signedIn"; user: User };
type Route = { name: "tabs" } | { name: "editor"; listingId?: string };
type Tab = "listings" | "showings";

/**
 * Surette team app: restores the session from the keychain, then shows Listings
 * and Showings tabs, with a full-screen editor for creating and editing listings.
 */
export default function App() {
  const [session, setSession] = useState<Session>({ status: "booting" });
  const [route, setRoute] = useState<Route>({ name: "tabs" });
  const [tab, setTab] = useState<Tab>("listings");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    (async () => {
      const saved = await tokenStore.get();
      if (!saved) return setSession({ status: "signedOut" });
      setSessionToken(saved);
      try {
        const { user } = await api.me();
        if (user.role === "client") throw new ApiError(403, "FORBIDDEN", "This app is for the Surette team.");
        setSession({ status: "signedIn", user });
      } catch (err) {
        await tokenStore.clear();
        setSessionToken(null);
        setSession({ status: "signedOut", notice: err instanceof ApiError && err.status === 401 ? "Your session expired. Please sign in again." : err instanceof Error ? err.message : undefined });
      }
    })();
  }, []);

  const signIn = useCallback(async (token: string, user: User) => {
    setSessionToken(token);
    await tokenStore.set(token);
    setSession({ status: "signedIn", user });
  }, []);

  const signOut = useCallback(async () => {
    setSessionToken(null);
    await tokenStore.clear();
    setRoute({ name: "tabs" });
    setSession({ status: "signedOut" });
  }, []);

  let content;
  if (session.status === "booting") {
    content = (
      <View className="flex-1 items-center justify-center bg-ivory dark:bg-ivory-dark">
        <ActivityIndicator />
      </View>
    );
  } else if (session.status === "signedOut") {
    content = <LoginScreen onSignedIn={signIn} notice={session.notice} />;
  } else if (route.name === "editor") {
    content = (
      <ListingEditor
        listingId={route.listingId}
        onClose={(changed) => {
          if (changed) setRefreshKey((k) => k + 1);
          setRoute({ name: "tabs" });
        }}
      />
    );
  } else {
    content = (
      <SafeAreaView className="flex-1 bg-ivory dark:bg-ivory-dark" edges={["top"]}>
        <View className="flex-row items-center justify-between px-4 pb-1 pt-2">
          <Text className="text-[13px] text-ink2 dark:text-ink2-dark">{session.user.fullName}</Text>
          <Pressable onPress={() => void signOut()} accessibilityRole="button" accessibilityLabel="Sign out" className="flex-row items-center gap-1.5 p-2">
            <LogOut size={16} />
            <Text className="text-[13px] text-ink dark:text-ink-dark">Sign out</Text>
          </Pressable>
        </View>
        <View className="flex-1">
          {tab === "listings" ? (
            <ListingsScreen refreshKey={refreshKey} onCreate={() => setRoute({ name: "editor" })} onOpen={(id) => setRoute({ name: "editor", listingId: id })} />
          ) : (
            <ShowingsScreen />
          )}
        </View>
        <View className="flex-row border-t border-line bg-paper pb-7 pt-2 dark:border-line-dark dark:bg-paper-dark" accessibilityRole="tablist">
          {([
            { key: "listings", label: "Listings", Icon: HomeIcon },
            { key: "showings", label: "Showings", Icon: CalendarClock },
          ] as const).map(({ key, label, Icon }) => (
            <Pressable
              key={key}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === key }}
              onPress={() => { haptic(); setTab(key); }}
              className="flex-1 items-center gap-1 py-1"
            >
              <Icon size={22} color={tab === key ? "#A67C3D" : undefined} />
              <Text className={`text-[11px] ${tab === key ? "font-semibold text-gold dark:text-gold-dark" : "text-ink2 dark:text-ink2-dark"}`}>{label}</Text>
            </Pressable>
          ))}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      {content}
    </SafeAreaProvider>
  );
}
