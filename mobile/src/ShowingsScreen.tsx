import { useCallback, useEffect, useState } from "react";
import { Alert, FlatList, Linking, Pressable, RefreshControl, Text, View } from "react-native";
import { api, ApiError, type Showing, type ShowingStatus } from "./api";
import { Button, Eyebrow, haptic, serif } from "./ui";

const when = (iso: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));

/** Showing requests from the website and AI assistant. Confirm on the go; overlaps are rejected by the server. */
export function ShowingsScreen() {
  const [showings, setShowings] = useState<Showing[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setShowings((await api.showings()).showings);
      setError("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load showings.");
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    void load();
    const t = setInterval(load, 20_000);
    return () => clearInterval(t);
  }, [load]);

  async function update(s: Showing, status: ShowingStatus) {
    try {
      await api.updateShowing(s.id, status);
      haptic("success");
      await load();
    } catch (e) {
      haptic("error");
      Alert.alert("Couldn't update", e instanceof Error ? e.message : "Please try again.");
    }
  }

  return (
    <FlatList
      data={showings}
      keyExtractor={(s) => s.id}
      contentContainerClassName="gap-3 px-4 pb-32 pt-2"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
      ListHeaderComponent={
        <View className="mb-2 mt-2">
          <Eyebrow>Calendar</Eyebrow>
          <Text style={serif} className="mt-1 text-[32px] text-ink dark:text-ink-dark">Showings</Text>
          {error ? <Text className="mt-2 text-[14px] text-danger dark:text-danger-dark">{error}</Text> : null}
        </View>
      }
      ListEmptyComponent={!error ? <Text className="py-16 text-center text-ink2 dark:text-ink2-dark">No upcoming showings.</Text> : null}
      renderItem={({ item }) => (
        <View className="gap-2 rounded-3xl border border-line bg-paper p-4 dark:border-line-dark dark:bg-paper-dark">
          <Text className={`text-[12px] font-semibold uppercase tracking-[1.5px] ${item.status === "requested" ? "text-warn dark:text-warn-dark" : item.status === "confirmed" ? "text-success dark:text-success-dark" : "text-ink3 dark:text-ink3-dark"}`}>
            {item.status} · via {item.source === "ai_assistant" ? "AI assistant" : item.source}
          </Text>
          <Text className="text-[17px] font-semibold text-ink dark:text-ink-dark">{when(item.startsAt)}</Text>
          <Text className="text-[15px] text-ink dark:text-ink-dark">{item.propertyTitle}</Text>
          <Pressable onPress={() => void Linking.openURL(`mailto:${item.contactEmail}`)} accessibilityRole="link">
            <Text className="text-[14px] text-ink2 underline dark:text-ink2-dark">{item.contactName} · {item.contactEmail}</Text>
          </Pressable>
          {item.contactPhone ? (
            <Pressable onPress={() => void Linking.openURL(`tel:${item.contactPhone}`)} accessibilityRole="link">
              <Text className="text-[14px] text-ink2 underline dark:text-ink2-dark">{item.contactPhone}</Text>
            </Pressable>
          ) : null}
          {item.notes ? <Text className="text-[14px] italic text-ink3 dark:text-ink3-dark">“{item.notes}”</Text> : null}
          <View className="mt-2 flex-row gap-2">
            {item.status === "requested" && <View className="flex-1"><Button title="Confirm" onPress={() => void update(item, "confirmed")} /></View>}
            {item.status === "confirmed" && <View className="flex-1"><Button title="Mark done" variant="outline" onPress={() => void update(item, "completed")} /></View>}
            {(item.status === "requested" || item.status === "confirmed") && <View className="flex-1"><Button title="Cancel" variant="ghost" onPress={() => void update(item, "cancelled")} /></View>}
          </View>
        </View>
      )}
    />
  );
}
