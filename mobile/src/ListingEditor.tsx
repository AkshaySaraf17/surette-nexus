import * as ImagePicker from "expo-image-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as Location from "expo-location";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ArrowDown, ArrowUp, Camera, ChevronLeft, ImagePlus, LocateFixed, Star, Trash2 } from "./icons";
import { api, ApiError, mediaUrl, uploadListing, type ListingDetail, type UploadPhoto } from "./api";
import { Button, Card, Eyebrow, Field, haptic, SectionTitle, Segmented, serif } from "./ui";
import { centsToDollars, emptyListing, validateListing, type ListingFormValues } from "./validation";

/**
 * Create or edit a listing on the phone: details, amenities, structural features,
 * and photos from the library or camera. Photos are normalized on-device (HEIC → JPEG,
 * long edge ≤ 2400 px, EXIF stripped) and streamed as one multipart request to
 * /api/properties/upload; the website shows them as soon as the request commits.
 */

const MAX_EDGE = 2400;

interface Picked extends UploadPhoto {
  key: string;
}

function fromDetail(l: ListingDetail): ListingFormValues {
  return {
    title: l.title,
    headline: l.headline ?? "",
    description: l.description,
    addressLine: l.addressLine,
    city: l.city,
    state: l.state,
    postalCode: l.postalCode,
    latitude: l.latitude?.toString() ?? "",
    longitude: l.longitude?.toString() ?? "",
    status: l.status,
    listingType: l.listingType,
    price: centsToDollars(l.priceCents),
    tax: centsToDollars(l.taxAnnualCents),
    hoa: centsToDollars(l.hoaMonthlyCents),
    bedrooms: String(l.bedrooms),
    fullBaths: String(l.fullBaths),
    halfBaths: String(l.halfBaths),
    livingAreaSqft: l.livingAreaSqft?.toString() ?? "",
    lotSizeSqft: l.lotSizeSqft?.toString() ?? "",
    yearBuilt: l.yearBuilt?.toString() ?? "",
    isFeatured: l.isFeatured,
    amenities: l.amenities,
    features: Object.entries(l.structuralFeatures).map(([key, value]) => ({ key, value })),
  };
}

/** Convert a picked asset into an upload-ready JPEG (or keep a small JPEG/PNG/WebP as is). */
async function normalize(asset: ImagePicker.ImagePickerAsset, index: number): Promise<Picked> {
  const mime = (asset.mimeType ?? "image/jpeg").toLowerCase();
  const tooBig = Math.max(asset.width, asset.height) > MAX_EDGE;
  const needsConvert = mime.includes("heic") || mime.includes("heif") || tooBig || Platform.OS === "web";
  if (!needsConvert) {
    return { key: `${asset.assetId ?? asset.uri}-${index}`, uri: asset.uri, name: asset.fileName ?? `photo-${index + 1}.jpg`, type: mime, alt: "" };
  }
  const context = ImageManipulator.manipulate(asset.uri);
  if (tooBig) context.resize(asset.width >= asset.height ? { width: MAX_EDGE } : { height: MAX_EDGE });
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ compress: 0.88, format: SaveFormat.JPEG });
  const base = (asset.fileName ?? `photo-${index + 1}`).replace(/\.[^.]+$/, "");
  return { key: `${saved.uri}-${index}`, uri: saved.uri, name: `${base}.jpg`, type: "image/jpeg", alt: "" };
}

export function ListingEditor({ listingId, onClose }: { listingId?: string; onClose: (changed: boolean) => void }) {
  const [values, setValues] = useState<ListingFormValues>(emptyListing);
  const [existing, setExisting] = useState<ListingDetail | null>(null);
  const [loading, setLoading] = useState(Boolean(listingId));
  const [photos, setPhotos] = useState<Picked[]>([]);
  const [coverKey, setCoverKey] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [amenity, setAmenity] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    if (!listingId) return;
    api
      .listing(listingId)
      .then(({ property }) => {
        setExisting(property);
        setValues(fromDetail(property));
      })
      .catch((e) => setMessage(e instanceof Error ? e.message : "Couldn't load the listing."))
      .finally(() => setLoading(false));
  }, [listingId]);

  const set = <K extends keyof ListingFormValues>(key: K, value: ListingFormValues[K]) => setValues((v) => ({ ...v, [key]: value }));

  async function addPhotos(source: "library" | "camera") {
    const permission = source === "camera" ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Permission needed", source === "camera" ? "Allow camera access in Settings to take listing photos." : "Allow photo access in Settings to choose listing photos.");
      return;
    }
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 1, exif: false };
    const result =
      source === "camera"
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync({ ...options, allowsMultipleSelection: true, selectionLimit: 40 - photos.length, orderedSelection: true });
    if (result.canceled) return;
    setProcessing(true);
    try {
      const prepared: Picked[] = [];
      for (const [i, asset] of result.assets.entries()) prepared.push(await normalize(asset, photos.length + i));
      setPhotos((prev) => {
        const next = [...prev, ...prepared].slice(0, 40);
        if (!coverKey && !existing?.media.length && next[0]) setCoverKey(next[0].key);
        return next;
      });
      haptic("success");
    } catch (e) {
      setMessage(e instanceof Error ? `Couldn't prepare a photo: ${e.message}` : "Couldn't prepare a photo.");
    } finally {
      setProcessing(false);
    }
  }

  function move(index: number, delta: -1 | 1) {
    setPhotos((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    haptic();
  }

  async function pinToCurrentLocation() {
    setLocating(true);
    try {
      const { granted } = await Location.requestForegroundPermissionsAsync();
      if (!granted) {
        Alert.alert("Location off", "Allow location access to pin the listing where you're standing.");
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setValues((v) => ({ ...v, latitude: pos.coords.latitude.toFixed(6), longitude: pos.coords.longitude.toFixed(6) }));
      haptic("success");
    } catch {
      setMessage("Couldn't get your location. Enter coordinates manually.");
    } finally {
      setLocating(false);
    }
  }

  async function save() {
    setMessage("");
    const result = validateListing(values);
    if (result.errors) {
      setErrors(result.errors);
      setMessage("Please fix the highlighted fields.");
      haptic("error");
      return;
    }
    setErrors({});
    if (!existing && photos.length === 0) {
      setMessage("Add at least one photo to create a listing.");
      haptic("error");
      return;
    }
    try {
      if (photos.length || !existing) {
        setProgress(0);
        const coverIndex = coverKey ? photos.findIndex((p) => p.key === coverKey) : -1;
        await uploadListing({ propertyId: existing?.id, metadata: result.metadata, photos, coverIndex }, setProgress);
      } else {
        await api.updateListing(existing.id, result.metadata);
      }
      haptic("success");
      onClose(true);
    } catch (e) {
      haptic("error");
      if (e instanceof ApiError) {
        // Server field names → form field names where they differ.
        const map: Record<string, string> = { priceCents: "price", taxAnnualCents: "tax", hoaMonthlyCents: "hoa" };
        setErrors(Object.fromEntries(Object.entries(e.fields).map(([k, v]) => [map[k] ?? k, v])));
        setMessage(e.message);
      } else setMessage("Couldn't save. Please try again.");
    } finally {
      setProgress(null);
    }
  }

  if (loading) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-ivory dark:bg-ivory-dark">
        <ActivityIndicator />
      </SafeAreaView>
    );
  }

  const busy = progress !== null;
  const priceLabel = values.listingType === "rent" ? "Monthly rent ($)" : "Price ($)";

  return (
    <SafeAreaView className="flex-1 bg-ivory dark:bg-ivory-dark" edges={["top"]}>
      <View className="flex-row items-center justify-between border-b border-line px-3 py-2 dark:border-line-dark">
        <Pressable onPress={() => onClose(false)} accessibilityRole="button" accessibilityLabel="Back" className="h-11 flex-row items-center gap-1 px-2" disabled={busy}>
          <ChevronLeft size={20} />
          <Text className="text-[16px] text-ink dark:text-ink-dark">Listings</Text>
        </Pressable>
        <Text style={serif} className="text-[17px] text-ink dark:text-ink-dark">{existing ? "Edit listing" : "New listing"}</Text>
        <View className="w-20" />
      </View>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1">
        <ScrollView contentContainerClassName="gap-5 px-4 pb-40 pt-4" keyboardShouldPersistTaps="handled">
          <Card>
            <SectionTitle>Photos</SectionTitle>
            {existing && existing.media.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="mt-3 gap-2">
                {existing.media.map((m) => (
                  <Image key={m.id} source={{ uri: mediaUrl(m.variants.sm?.url ?? m.url) }} className="h-16 w-20 rounded-lg" accessibilityLabel={m.alt || "Published photo"} />
                ))}
              </ScrollView>
            )}
            <Text className="mt-2 text-[13px] text-ink2 dark:text-ink2-dark">
              {existing ? `${existing.media.length} published · new photos are added after them.` : "The first photo (or the starred one) becomes the cover."}
            </Text>
            <View className="mt-4 flex-row gap-3">
              <View className="flex-1"><Button title="Library" variant="outline" onPress={() => void addPhotos("library")} disabled={busy || processing} icon={<ImagePlus size={18} />} /></View>
              <View className="flex-1"><Button title="Camera" variant="outline" onPress={() => void addPhotos("camera")} disabled={busy || processing} icon={<Camera size={18} />} /></View>
            </View>
            {processing && <Text className="mt-3 text-[13px] text-ink2 dark:text-ink2-dark">Preparing photos…</Text>}
            <View className="mt-4 gap-3">
              {photos.map((p, i) => (
                <View key={p.key} className="flex-row items-center gap-3 rounded-2xl border border-line p-2 dark:border-line-dark">
                  <Image source={{ uri: p.uri }} className="h-16 w-16 rounded-xl" accessibilityIgnoresInvertColors />
                  <View className="flex-1 gap-1">
                    <Text numberOfLines={1} className="text-[13px] font-medium text-ink dark:text-ink-dark">{i + 1}. {p.name}</Text>
                    <TextInput
                      value={p.alt}
                      onChangeText={(alt) => setPhotos((prev) => prev.map((x) => (x.key === p.key ? { ...x, alt } : x)))}
                      placeholder="Describe the photo"
                      placeholderTextColor="#8C8579"
                      maxLength={300}
                      accessibilityLabel={`Description for photo ${i + 1}`}
                      className="rounded-lg border border-line px-2 py-1.5 text-[13px] text-ink dark:border-line-dark dark:text-ink-dark"
                    />
                  </View>
                  <View className="items-center gap-1">
                    <Pressable onPress={() => { haptic(); setCoverKey(p.key); }} accessibilityRole="button" accessibilityLabel={`Make photo ${i + 1} the cover`} accessibilityState={{ selected: coverKey === p.key }} className="p-1.5">
                      <Star size={18} filled={coverKey === p.key} />
                    </Pressable>
                    <View className="flex-row">
                      <Pressable onPress={() => move(i, -1)} accessibilityLabel={`Move photo ${i + 1} up`} className="p-1"><ArrowUp size={16} /></Pressable>
                      <Pressable onPress={() => move(i, 1)} accessibilityLabel={`Move photo ${i + 1} down`} className="p-1"><ArrowDown size={16} /></Pressable>
                    </View>
                    <Pressable onPress={() => setPhotos((prev) => prev.filter((x) => x.key !== p.key))} accessibilityLabel={`Remove photo ${i + 1}`} className="p-1.5"><Trash2 size={16} danger /></Pressable>
                  </View>
                </View>
              ))}
            </View>
          </Card>

          <Card className="gap-4">
            <SectionTitle>The residence</SectionTitle>
            <Field label="Title" value={values.title} onChangeText={(t) => set("title", t)} error={errors.title} placeholder="The Kennebec Federal" />
            <Field label="Headline" value={values.headline} onChangeText={(t) => set("headline", t)} maxLength={200} />
            <Field label="Description" value={values.description} onChangeText={(t) => set("description", t)} multiline textAlignVertical="top" style={{ minHeight: 120, paddingTop: 12 }} />
          </Card>

          <Card className="gap-4">
            <SectionTitle>Address</SectionTitle>
            <Field label="Street address" value={values.addressLine} onChangeText={(t) => set("addressLine", t)} error={errors.addressLine} textContentType="streetAddressLine1" />
            <View className="flex-row gap-3">
              <View className="flex-[2]"><Field label="Town" value={values.city} onChangeText={(t) => set("city", t)} error={errors.city} /></View>
              <View className="flex-1"><Field label="State" value={values.state} onChangeText={(t) => set("state", t)} error={errors.state} maxLength={2} autoCapitalize="characters" /></View>
              <View className="flex-[1.4]"><Field label="ZIP" value={values.postalCode} onChangeText={(t) => set("postalCode", t)} error={errors.postalCode} keyboardType="number-pad" /></View>
            </View>
            <View className="flex-row gap-3">
              <View className="flex-1"><Field label="Latitude" value={values.latitude} onChangeText={(t) => set("latitude", t)} error={errors.latitude} keyboardType="numbers-and-punctuation" /></View>
              <View className="flex-1"><Field label="Longitude" value={values.longitude} onChangeText={(t) => set("longitude", t)} error={errors.longitude} keyboardType="numbers-and-punctuation" /></View>
            </View>
            <Button title={locating ? "Locating…" : "Use my current location"} variant="outline" onPress={() => void pinToCurrentLocation()} loading={locating} icon={<LocateFixed size={18} />} />
          </Card>

          <Card className="gap-4">
            <SectionTitle>Listing</SectionTitle>
            <Segmented label="Status" value={values.status} onChange={(v) => set("status", v)} options={[{ value: "draft", label: "Draft" }, { value: "active", label: "Active" }, { value: "pending", label: "Pending" }, { value: "sold", label: "Sold" }, { value: "off_market", label: "Off market" }]} />
            <Segmented label="Type" value={values.listingType} onChange={(v) => set("listingType", v)} options={[{ value: "sale", label: "For sale" }, { value: "rent", label: "For lease" }]} />
            <Field label={priceLabel} value={values.price} onChangeText={(t) => set("price", t)} error={errors.price} keyboardType="decimal-pad" placeholder="1,250,000" hint="Stored exactly, in cents." />
            <View className="flex-row gap-3">
              <View className="flex-1"><Field label="Annual taxes ($)" value={values.tax} onChangeText={(t) => set("tax", t)} error={errors.tax} keyboardType="decimal-pad" /></View>
              <View className="flex-1"><Field label="HOA / month ($)" value={values.hoa} onChangeText={(t) => set("hoa", t)} error={errors.hoa} keyboardType="decimal-pad" /></View>
            </View>
            <View className="flex-row gap-3">
              <View className="flex-1"><Field label="Beds" value={values.bedrooms} onChangeText={(t) => set("bedrooms", t)} error={errors.bedrooms} keyboardType="number-pad" /></View>
              <View className="flex-1"><Field label="Full baths" value={values.fullBaths} onChangeText={(t) => set("fullBaths", t)} error={errors.fullBaths} keyboardType="number-pad" /></View>
              <View className="flex-1"><Field label="Half baths" value={values.halfBaths} onChangeText={(t) => set("halfBaths", t)} error={errors.halfBaths} keyboardType="number-pad" /></View>
            </View>
            <View className="flex-row gap-3">
              <View className="flex-1"><Field label="Interior sq ft" value={values.livingAreaSqft} onChangeText={(t) => set("livingAreaSqft", t)} error={errors.livingAreaSqft} keyboardType="number-pad" /></View>
              <View className="flex-1"><Field label="Lot sq ft" value={values.lotSizeSqft} onChangeText={(t) => set("lotSizeSqft", t)} error={errors.lotSizeSqft} keyboardType="number-pad" /></View>
              <View className="flex-1"><Field label="Year built" value={values.yearBuilt} onChangeText={(t) => set("yearBuilt", t)} error={errors.yearBuilt} keyboardType="number-pad" /></View>
            </View>
            <View className="flex-row items-center justify-between">
              <Text className="text-[15px] text-ink dark:text-ink-dark">Feature on the home page</Text>
              <Switch value={values.isFeatured} onValueChange={(v) => set("isFeatured", v)} trackColor={{ true: "#A67C3D" }} accessibilityLabel="Feature on the home page" />
            </View>
          </Card>

          <Card className="gap-4">
            <SectionTitle>Amenities & structure</SectionTitle>
            <Field
              label="Add an amenity"
              value={amenity}
              onChangeText={setAmenity}
              returnKeyType="done"
              onSubmitEditing={() => {
                const a = amenity.trim();
                if (a && !values.amenities.includes(a)) set("amenities", [...values.amenities, a]);
                setAmenity("");
              }}
              placeholder="Private dock — press return to add"
              maxLength={60}
            />
            <View className="flex-row flex-wrap gap-2">
              {values.amenities.map((a) => (
                <Pressable key={a} onPress={() => set("amenities", values.amenities.filter((x) => x !== a))} accessibilityLabel={`Remove ${a}`} className="rounded-full bg-fill px-3 py-1.5 dark:bg-fill-dark">
                  <Text className="text-[13px] text-ink dark:text-ink-dark">{a} ×</Text>
                </Pressable>
              ))}
            </View>
            {values.features.map((f, i) => (
              <View key={i} className="flex-row items-end gap-2">
                <View className="flex-1"><Field label={i === 0 ? "Feature" : " "} value={f.key} onChangeText={(t) => set("features", values.features.map((x, j) => (j === i ? { ...x, key: t } : x)))} placeholder="Roof" /></View>
                <View className="flex-[1.6]"><Field label={i === 0 ? "Detail" : " "} value={f.value} onChangeText={(t) => set("features", values.features.map((x, j) => (j === i ? { ...x, value: t } : x)))} placeholder="Metal (2021)" /></View>
                <Pressable onPress={() => set("features", values.features.filter((_, j) => j !== i))} accessibilityLabel="Remove feature" className="h-12 justify-center px-1"><Trash2 size={16} /></Pressable>
              </View>
            ))}
            <Button title="Add feature" variant="ghost" onPress={() => set("features", [...values.features, { key: "", value: "" }])} />
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>

      <View className="absolute inset-x-0 bottom-0 gap-2 border-t border-line bg-paper px-4 pb-8 pt-3 dark:border-line-dark dark:bg-paper-dark">
        {message ? <Text className="text-[13px] text-danger dark:text-danger-dark" accessibilityLiveRegion="polite">{message}</Text> : null}
        {busy && (
          <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round((progress ?? 0) * 100) }}>
            <View className="h-1.5 overflow-hidden rounded-full bg-fill dark:bg-fill-dark">
              <View className="h-full rounded-full bg-gold dark:bg-gold-dark" style={{ width: `${Math.round((progress ?? 0) * 100)}%` }} />
            </View>
            <Text className="mt-1 text-[12px] text-ink2 dark:text-ink2-dark">{(progress ?? 0) < 1 ? `Uploading ${Math.round((progress ?? 0) * 100)}%` : "Optimizing and publishing…"}</Text>
          </View>
        )}
        <Eyebrow>{values.status === "draft" ? "Hidden until published" : "Publishes to the website instantly"}</Eyebrow>
        <Button
          title={busy ? "Publishing…" : existing ? (photos.length ? `Save & upload ${photos.length}` : "Save changes") : values.status === "draft" ? "Save draft" : "Publish listing"}
          variant="gold"
          onPress={() => void save()}
          loading={busy}
          disabled={processing}
        />
      </View>
    </SafeAreaView>
  );
}
