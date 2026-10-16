// Demo brokerage site — fictional listings, synthetic analytics project "demo-site".
// Nothing here sends personal data anywhere: the contact form only fires analytics events.
window.DEMO_LISTINGS = [
  { id: "7a1f0c52-1d1e-4f43-9b0a-0d6c1c1a0001", title: "12 Birch Lane", city: "Lakeview", price: 329000, beds: 3, baths: 2 },
  { id: "7a1f0c52-1d1e-4f43-9b0a-0d6c1c1a0002", title: "88 River Road", city: "Millbrook", price: 459000, beds: 4, baths: 3 },
  { id: "7a1f0c52-1d1e-4f43-9b0a-0d6c1c1a0003", title: "5 Orchard Way", city: "Lakeview", price: 249000, beds: 2, baths: 1 },
  { id: "7a1f0c52-1d1e-4f43-9b0a-0d6c1c1a0004", title: "301 Summit Drive", city: "Highfield", price: 615000, beds: 5, baths: 4 },
  { id: "7a1f0c52-1d1e-4f43-9b0a-0d6c1c1a0005", title: "44 Mill Pond Court", city: "Millbrook", price: 389000, beds: 3, baths: 2 },
  { id: "7a1f0c52-1d1e-4f43-9b0a-0d6c1c1a0006", title: "9 Cedar Hollow", city: "Highfield", price: 199000, beds: 2, baths: 1 },
];
const fmt = (n) => "$" + n.toLocaleString("en-US");
function card(l) {
  return `<a class="card" href="listing.html?id=${l.id}" data-sa-property-card="${l.id}">
    <div class="ph" role="img" aria-label="Placeholder photo"></div>
    <div class="b"><div class="price">${fmt(l.price)}</div><div>${l.title}</div><div class="muted">${l.city} · ${l.beds} bd · ${l.baths} ba</div></div></a>`;
}
// Consent banner (opt-in): the SDK sends nothing until the visitor chooses.
function consentBanner() {
  const el = document.getElementById("consent");
  if (!el || !window.SuretteAnalytics) return;
  if (window.SuretteAnalytics.getConsent() === "unset") el.hidden = false;
  el.querySelector("[data-accept]").onclick = () => { window.SuretteAnalytics.consent("granted"); el.hidden = true; };
  el.querySelector("[data-decline]").onclick = () => { window.SuretteAnalytics.consent("denied"); el.hidden = true; };
}
window.addEventListener("load", consentBanner);
