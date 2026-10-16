import { useCallback, useEffect, useState } from "react";
import { FlatList, Image, Pressable, RefreshControl, Text, View } from "react-native";
import { api, ApiError, formatPrice, mediaUrl, type ListingCard } from "./api";
import { Plus } from "./icons";
import { Eyebrow, haptic, serif, STATUS_LABEL } from "./ui";

const POLL_MS = 20_000;

/** Every listing of the team (drafts included). Refreshes on pull, on focus and every 20 s. */
export function ListingsScreen({ onOpen, onCreate, refreshKey }: { onOpen: (id: string) => void; onCreate: () => void; refreshKey: number }) {
  const [listings, setListings] = useState<ListingCard[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const { listings } = await api.listings();
      setListings(listings);
      setError("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load listings.");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    void load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load, refreshKey]);

  return (
    <View className="flex-1">
      <FlatList
        data={listings}
        keyExtractor={(l) => l.id}
        contentContainerClassName="gap-4 px-4 pb-32 pt-2"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
        ListHeaderComponent={
          <View className="mb-2 mt-2">
            <Eyebrow>Portfolio</Eyebrow>
            <Text style={serif} className="mt-1 text-[32px] text-ink dark:text-ink-dark">Listings</Text>
            {error ? <Text className="mt-2 text-[14px] text-danger dark:text-danger-dark">{error}</Text> : null}
          </View>
        }
        ListEmptyComponent={!error ? <Text className="py-16 text-center text-ink2 dark:text-ink2-dark">No listings yet. Tap + to add the first one.</Text> : null}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => { haptic(); onOpen(item.id); }}
            accessibilityRole="button"
            accessibilityLabel={`${item.title}, ${STATUS_LABEL[item.status]}, ${formatPrice(item.priceCents)}`}
            className="overflow-hidden rounded-3xl border border-line bg-paper active:opacity-90 dark:border-line-dark dark:bg-paper-dark"
          >
            {item.cover ? (
              <Image source={{ uri: mediaUrl(item.cover.variants.md?.url ?? item.cover.url) }} className="aspect-[16/10] w-full" accessibilityIgnoresInvertColors />
            ) : (
              <View className="aspect-[16/10] w-full items-center justify-center bg-fill dark:bg-fill-dark"><Text className="text-ink3 dark:text-ink3-dark">No photos yet</Text></View>
            )}
            <View className="gap-1 p-4">
              <View className="flex-row items-center justify-between">
                <Text className="text-[11px] font-semibold uppercase tracking-[1.5px] text-ink3 dark:text-ink3-dark">{item.city}, {item.state}</Text>
                <Text className={`text-[12px] font-semibold ${item.status === "active" ? "text-success dark:text-success-dark" : item.status === "draft" ? "text-warn dark:text-warn-dark" : "text-ink2 dark:text-ink2-dark"}`}>{STATUS_LABEL[item.status]}</Text>
              </View>
              <Text style={serif} className="text-[21px] text-ink dark:text-ink-dark">{item.title}</Text>
              <Text className="text-[14px] text-ink2 dark:text-ink2-dark">
                {formatPrice(item.priceCents)}{item.listingType === "rent" ? "/mo" : ""} · {item.bedrooms} bd · {item.mediaCount} photos
              </Text>
            </View>
          </Pressable>
        )}
      />
      <Pressable
        onPress={() => { haptic(); onCreate(); }}
        accessibilityRole="button"
        accessibilityLabel="New listing"
        className="absolute bottom-8 right-5 h-16 w-16 items-center justify-center rounded-full bg-ink shadow-lg active:opacity-80 dark:bg-ink-dark"
      >
        <Plus size={26} color="#D9B98A" />
      </Pressable>
    </View>
  );
}
