import React, { useEffect, useState } from "react";
import { StepCard } from "./step-card";
import { ApiConnection } from "./api-connection";
import { ImageUploader } from "./image-uploader";
import { ProductSelector } from "./product-selector";
import { ProductRules } from "./product-rules";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { CheckCircle, Loader2, Package, Rocket, Layers, Plus, Trash2, Save, Star, Tag, Boxes } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

const STORE_ID = import.meta.env.VITE_GELATO_STORE_ID as string | undefined;
const WORKER_BASE = "https://gelato-backend.andrea-bilotta00.workers.dev";

type ImageFile = { id: string; file: File; preview: string; name: string; size: string };
type Product = { id: string; name: string; type: string; variants: string[]; printAreas: string[] };
type RefProduct = { legacyId: string; title: string; image: string | null };
type ProductRulesType = {
  titleMode: "filename" | "ai-simple" | "ai-compound";
  titleMaxWords: number;
  titleCustomText: string;
  descriptionMode: "copy" | "ai";
  descriptionParagraphs: number;
  descriptionSentences: number;
  descriptionCustomHTML: string;
  tagsMode: "copy" | "ai";
  tagsMaxCount: number;
  tagsCustom: string[];
  includeCustomTitle: boolean;
  includeCustomDescription: boolean;
};

const defaultRules: ProductRulesType = {
  titleMode: "filename", titleMaxWords: 8, titleCustomText: "",
  descriptionMode: "copy", descriptionParagraphs: 2, descriptionSentences: 3,
  descriptionCustomHTML: "", tagsMode: "copy", tagsMaxCount: 10,
  tagsCustom: [], includeCustomTitle: false, includeCustomDescription: false,
};

const isUuid = (s?: string) => !!s?.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

function getFileRatioTag(filename: string): string {
  const l = filename.toLowerCase();
  if (l.includes("(3x4)") || l.includes("3x4")) return "3x4";
  if (l.includes("(5x7)") || l.includes("5x7") || l.includes("iso")) return "5x7";
  if (l.includes("(1x1)") || l.includes("1x1")) return "1x1";
  return "default";
}

function getCleanBaseTitle(filename: string): string {
  let base = filename.replace(/\.[^/.]+$/, "");
  base = base.replace(/\s*(?:\bISO\b)?\s*\([^)]*\)/i, "").trim();
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function getVariantRatioTag(variantTitle: string): string {
  const l = (variantTitle || "").toLowerCase();
  if (l.includes("30x40") || l.includes("40x30") || l.includes("60x45") || l.includes("75x100")) return "3x4";
  if (l.includes("50x70") || l.includes("70x50") || l.includes("100x140") || l.includes("140x100")) return "5x7";
  if (l.includes("30x30") || l.includes("50x50") || l.includes("100x100") || l.includes("70x70")) return "1x1";
  return "default";
}

// Picker prodotti dal catalogo Shopify (via worker /shopify-search-products)
function ShopifyProductPicker({ label, hint, icon, value, onChange }: { label: string; hint: string; icon?: React.ReactNode; value: RefProduct | null; onChange: (p: RefProduct | null) => void; }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<RefProduct[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!q || q.trim().length < 2) { setResults([]); return; }
    let active = true; setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`${WORKER_BASE}/shopify-search-products?q=${encodeURIComponent(q.trim())}`);
        const d = await r.json();
        if (active) setResults((d.products || []).map((p: any) => ({ legacyId: p.legacyId, title: p.title, image: p.image })));
      } catch { /* ignore */ } finally { if (active) setLoading(false); }
    }, 350);
    return () => { active = false; clearTimeout(t); };
  }, [q]);
  return (
    <div className="space-y-1">
      <label className="text-sm font-medium flex items-center gap-2">{icon}{label}</label>
      <p className="text-xs text-muted-foreground">{hint}</p>
      {value ? (
        <div className="flex items-center justify-between rounded-lg p-2.5" style={{ background: "oklch(0.24 0.03 265)", border: "1px solid oklch(0.5 0.1 290)" }}>
          <div className="flex items-center gap-2 min-w-0">
            {value.image && <img src={value.image} alt="" className="h-9 w-9 rounded object-cover" />}
            <span className="text-sm truncate font-medium">{value.title}</span>
          </div>
          <Button size="sm" variant="secondary" onClick={() => { onChange(null); setQ(""); }}>Cambia</Button>
        </div>
      ) : (
        <div className="relative">
          <Input value={q} placeholder="Cerca un prodotto nel catalogo..." style={{ background: "oklch(0.12 0.012 260)" }} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} />
          {open && q.trim().length >= 2 && (
            <div className="mt-2 w-full rounded-lg max-h-72 overflow-auto shadow-2xl" style={{ background: "oklch(0.26 0.035 265)", border: "1px solid oklch(0.55 0.1 290)" }}>
              {loading && <div className="p-3 text-xs text-muted-foreground">Ricerca in corso...</div>}
              {!loading && results.length === 0 && <div className="p-3 text-xs text-muted-foreground">Nessun prodotto trovato per "{q}"</div>}
              {results.map((p) => (
                <button key={p.legacyId} type="button" className="flex items-center gap-2 w-full text-left p-2.5 transition-colors hover:bg-white/10" onClick={() => { onChange(p); setOpen(false); setQ(""); }}>
                  {p.image && <img src={p.image} alt="" className="h-9 w-9 rounded object-cover" />}
                  <span className="text-sm truncate">{p.title}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

async function uploadOriginalFile(file: File, exactFileName: string) {
  const BASE_URL = WORKER_BASE;
  const CHUNK_SIZE = 6 * 1024 * 1024;
  const startRes = await fetch(`${BASE_URL}/upload-start?filename=${encodeURIComponent(exactFileName)}`, { method: "POST" });
  if (!startRes.ok) { const e = await startRes.json().catch(() => ({})); throw new Error(`Errore Inizio Upload: ${e.error || await startRes.text()}`); }
  const { uploadId, key } = await startRes.json();
  const encodedUploadId = encodeURIComponent(uploadId);
  const encodedKey = encodeURIComponent(key);
  const parts = [];
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  for (let i = 0; i < totalChunks; i++) {
    const chunk = file.slice(i * CHUNK_SIZE, Math.min((i + 1) * CHUNK_SIZE, file.size));
    const partNumber = i + 1;
    let partData = null; let retries = 3; let lastError = "";
    while (retries > 0) {
      try {
        const partRes = await fetch(`${BASE_URL}/upload-part?uploadId=${encodedUploadId}&key=${encodedKey}&partNumber=${partNumber}`, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: chunk });
        if (!partRes.ok) { const e = await partRes.json().catch(() => ({})); throw new Error(e.error || `Codice ${partRes.status}`); }
        partData = await partRes.json(); break;
      } catch (e: any) { lastError = e.message; retries--; if (retries === 0) throw new Error(`Fallito chunk ${partNumber}/${totalChunks}: ${lastError}`); await new Promise(r => setTimeout(r, 1000)); }
    }
    parts.push(partData);
  }
  const completeRes = await fetch(`${BASE_URL}/upload-complete?uploadId=${encodedUploadId}&key=${encodedKey}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ parts }) });
  if (!completeRes.ok) { const e = await completeRes.json().catch(() => ({})); throw new Error(`Errore Assemblaggio: ${e.error || await completeRes.text()}`); }
  return (await completeRes.json()).url;
}

export function BulkCreator() {
  const [currentStep, setCurrentStep] = useState(1);
  const [isConnected, setIsConnected] = useState(false);
  const [credentials, setCredentials] = useState<{ apiKey: string; storeName: string } | null>(null);
  const [images, setImages] = useState<ImageFile[]>([]);
  const [processingOptions, setProcessingOptions] = useState({ upscale: true, fitMode: "stretch" as "stretch" | "preserve" | "exact" });
  const [selectedProduct, setSelectedProduct] = useState<Product | undefined>();
  const [rules, setRules] = useState<ProductRulesType>(defaultRules);
  const [isCreating, setIsCreating] = useState(false);
  const [creationProgress, setCreationProgress] = useState(0);
  const [createdProducts, setCreatedProducts] = useState<any[]>([]);
  const [template, setTemplate] = useState<any | null>(null);
  const [extraSlots, setExtraSlots] = useState<{ product?: Product }[]>([]);
  // v24: impostazioni post-pubblicazione (per-run)
  const [mostPopularVariant, setMostPopularVariant] = useState("");
  const [priceRef, setPriceRef] = useState<RefProduct | null>(null);
  const [inventoryRef, setInventoryRef] = useState<RefProduct | null>(null);
  const setSetting = trpc.settings.set.useMutation();

  useEffect(() => {
    try {
      const raw = localStorage.getItem("gelato.creds");
      if (raw) { const c = JSON.parse(raw); setCredentials(c); setIsConnected(true); setCurrentStep(2); }
    } catch {}
  }, []);

  // ricorda le ultime scelte di automazione
  useEffect(() => {
    try {
      const raw = localStorage.getItem("gelato.automation");
      if (raw) { const a = JSON.parse(raw); if (a.mostPopularVariant) setMostPopularVariant(a.mostPopularVariant); if (a.priceRef) setPriceRef(a.priceRef); if (a.inventoryRef) setInventoryRef(a.inventoryRef); }
    } catch {}
  }, []);
  useEffect(() => {
    try { localStorage.setItem("gelato.automation", JSON.stringify({ mostPopularVariant, priceRef, inventoryRef })); } catch {}
  }, [mostPopularVariant, priceRef, inventoryRef]);

  // ricorda i template scelti nello step 3 (permanente, per la prossima run)
  useEffect(() => {
    try {
      const raw = localStorage.getItem("gelato.templates");
      if (raw) { const t = JSON.parse(raw); if (t.selectedProduct) setSelectedProduct(t.selectedProduct); if (Array.isArray(t.extraSlots)) setExtraSlots(t.extraSlots); }
    } catch {}
  }, []);
  useEffect(() => {
    try { localStorage.setItem("gelato.templates", JSON.stringify({ selectedProduct: selectedProduct || null, extraSlots })); } catch {}
  }, [selectedProduct, extraSlots]);
  // se il template e' gia' ricordato e ci sono immagini, vai diretto allo step 4
  useEffect(() => {
    if (selectedProduct && images.length > 0) setCurrentStep((c) => Math.max(c, 4));
  }, [selectedProduct, images.length]);

  const handleConnect = (creds: { apiKey: string; storeName: string }) => {
    setCredentials(creds); setIsConnected(true); setCurrentStep(2);
    try { const v = JSON.stringify(creds); localStorage.setItem("gelato.creds", v); setSetting.mutate({ key: "gelato.creds", value: v }); } catch {}
    toast.success(`Connesso a ${creds.storeName}`);
  };

  const handleImagesChange = (newImages: ImageFile[]) => {
    setImages(newImages);
    setCurrentStep((prev) => (newImages.length > 0 ? Math.max(prev, 3) : prev));
  };

  const handleProductSelect = (product: Product) => {
    setSelectedProduct(product);
    setCurrentStep((prev) => Math.max(prev, 4));
  };

  const handleCreateProducts = async () => {
    if (!images.length || !selectedProduct) return;
    if (!isUuid(selectedProduct.id)) { toast.error("Carica un VERO Template ID Gelato (UUID)"); return; }
    setIsCreating(true); setCreationProgress(0);
    try {
      const templateList: { id: string; label: string }[] = [
        { id: selectedProduct.id, label: "" },
        ...extraSlots.filter(s => s.product && isUuid(s.product.id)).map(s => ({ id: s.product!.id, label: (s.product!.name || "").trim() })),
      ];

      // settings post-pubblicazione (uguali per tutto il run)
      const runSettings = {
        mostPopular: mostPopularVariant.trim() || "",
        priceRef: priceRef?.legacyId || "",
        inventoryRef: inventoryRef?.legacyId || "",
      };

      // 1) Raggruppa e CARICA le immagini UNA VOLTA SOLA (riusate per ogni template)
      const groupedProducts: Record<string, Record<string, ImageFile>> = {};
      for (const img of images) {
        const baseTitle = getCleanBaseTitle(img.name);
        const ratioTag = getFileRatioTag(img.name);
        if (!groupedProducts[baseTitle]) groupedProducts[baseTitle] = {};
        groupedProducts[baseTitle][ratioTag] = img;
      }
      const uploadedByGroup: Record<string, { title: string; urls: Record<string, string> }> = {};
      let processedGroups = 0;
      const totalGroups = Object.keys(groupedProducts).length;
      for (const [baseTitle, fileMap] of Object.entries(groupedProducts)) {
        let title = rules.titleMode === "filename" ? baseTitle : `Prodotto ${processedGroups + 1}`;
        if (rules.includeCustomTitle && rules.titleCustomText) title += ` ${rules.titleCustomText}`;
        const uploadedUrls: Record<string, string> = {};
        for (const [ratioTag, imageObj] of Object.entries(fileMap)) {
          let exactFileName = `${baseTitle}.jpg`;
          if (ratioTag === "3x4") exactFileName = `${baseTitle} (3x4).jpg`;
          if (ratioTag === "5x7") exactFileName = `${baseTitle} ISO (5x7).jpg`;
          uploadedUrls[ratioTag] = await uploadOriginalFile(imageObj.file, exactFileName);
        }
        uploadedByGroup[baseTitle] = { title, urls: uploadedUrls };
        processedGroups++;
        setCreationProgress((processedGroups / totalGroups) * 40);
      }

      // 2) Per OGNI template (Poster, Canvas, Framed...): scarica varianti, costruisci, pubblica
      const allResults: any[] = [];
      let tIndex = 0;
      for (const t of templateList) {
        const tplRes = await fetch(`${WORKER_BASE}/gelato-get-template?templateId=${t.id}`);
        if (!tplRes.ok) { allResults.push({ title: `Template ${t.id.slice(0, 8)}`, status: "error", error: "Template non trovato" }); tIndex++; continue; }
        const tpl = await tplRes.json();
        if (t.id === selectedProduct.id) setTemplate(tpl);
        const tplVariants: any[] = tpl?.variants ?? [];
        if (!tplVariants.length) { allResults.push({ title: tpl?.title || t.id.slice(0, 8), status: "error", error: "Nessuna variante nel template" }); tIndex++; continue; }
        const products = [];
        for (const [, grp] of Object.entries(uploadedByGroup)) {
          const suffix = t.label ? ` — ${t.label}` : "";
          const variantsPayload = [];
          for (const v of tplVariants) {
            const placeholderName = v?.imagePlaceholders?.[0]?.name || tpl?.imagePlaceholders?.[0]?.name || "front";
            const variantRatio = getVariantRatioTag(v.title);
            const matchedUrl = grp.urls[variantRatio] || grp.urls["default"] || Object.values(grp.urls)[0];
            variantsPayload.push({ templateVariantId: v.id, imagePlaceholders: [{ name: placeholderName, fileUrl: matchedUrl }] });
          }
          products.push({ title: grp.title + suffix, description: rules.descriptionCustomHTML || "Generated by Gelato Bulk Creator", tags: rules.tagsCustom.length > 0 ? rules.tagsCustom : ["gelato", "bulk-created"], variants: variantsPayload });
        }
        const createRes = await fetch(`${WORKER_BASE}/gelato-bulk-create`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ templateId: tpl.id, publish: true, products, storeId: STORE_ID, salesChannels: ["shopify"], settings: runSettings }),
        });
        let data: any = {}; try { data = await createRes.json(); } catch {}
        const results = (data.results || []).map((r: any) => ({ ...r, templateName: tpl.title || t.label || tpl.productType }));
        if (!createRes.ok && !results.length) allResults.push({ title: tpl.title || t.id.slice(0, 8), status: "error", error: data.error || "Errore pubblicazione" });
        else allResults.push(...results);
        tIndex++;
        setCreationProgress(40 + (tIndex / templateList.length) * 60);
      }

      setCreatedProducts(allResults); setCreationProgress(100); setIsCreating(false);
      const successCount = allResults.filter((r: any) => r.status === "active" || r.status === "created_in_background").length;
      const errorCount = allResults.filter((r: any) => r.status === "error").length;
      if (successCount > 0) toast.success(`Creati ${successCount} prodotti su ${templateList.length} template${errorCount ? `, ${errorCount} falliti` : ""}`);
      else toast.error("0 prodotti creati. Controlla i Template ID.");
    } catch (error: any) {
      setIsCreating(false); setCreationProgress(0);
      toast.error(error?.message ?? "Operazione fallita inaspettatamente", { duration: 10000 });
    }
  };

  const totalGroupsCalculated = Object.keys(images.reduce((acc: any, img) => { acc[getCleanBaseTitle(img.name)] = true; return acc; }, {})).length;
  const completedSteps = [isConnected, images.length > 0, !!selectedProduct, createdProducts.length > 0].filter(Boolean).length;
  const successCount = createdProducts.filter((r: any) => r.status === "active").length;

  return (
    <div className="space-y-8">
      <Card style={{ background: "oklch(0.14 0.015 260)", border: "1px solid oklch(0.25 0.02 265 / 0.4)" }}>
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">Stato Avanzamento</h2>
            <Badge style={{ background: "var(--gradient-primary)", color: "white", border: "none" }}>Step {currentStep} di 4</Badge>
          </div>
          <Progress value={(completedSteps / 4) * 100} className="mb-2" />
          <p className="text-sm text-muted-foreground">{completedSteps}/4 step completati</p>
        </CardContent>
      </Card>

      <StepCard step={1} title="Connetti lo Store Gelato" description="Inserisci le credenziali API" isActive={currentStep === 1} isCompleted={isConnected}>
        {(!isConnected || currentStep === 1) && <ApiConnection onConnect={handleConnect} isConnected={isConnected} storeName={credentials?.storeName} />}
      </StepCard>

      <StepCard step={2} title="Carica le Immagini" description="Upload Multi-Chunk sicuro — chunk da 6MB, retry automatico" isActive={currentStep === 2} isCompleted={images.length > 0}>
        {(currentStep >= 2) && isConnected && (
          <ImageUploader onImagesChange={handleImagesChange} processingOptions={processingOptions} onOptionsChange={setProcessingOptions} />
        )}
      </StepCard>

      <StepCard step={3} title="Scegli Template Gelato" description="Carica il Template ID (UUID)" isActive={currentStep === 3} isCompleted={!!selectedProduct}>
        {(currentStep === 3 || selectedProduct) && images.length > 0 && (
          <div className="space-y-4">
            <ProductSelector onProductSelect={handleProductSelect} selectedProduct={selectedProduct} />
            {selectedProduct && (
              <Card style={{ background: "oklch(0.14 0.015 260)", border: "1px solid oklch(0.2 0.015 260)" }}>
                <CardContent className="p-5 space-y-3">
                  <div>
                    <h3 className="font-semibold flex items-center gap-2"><Layers className="h-4 w-4" />Pubblica anche come (opzionale)</h3>
                    <p className="text-xs text-muted-foreground">Stesso design come prodotti separati: Canvas, Framed Poster, Framed Canvas… (nessun limite)</p>
                  </div>
                  {extraSlots.map((slot, i) => (
                    <div key={i} className="rounded-xl p-3 space-y-2" style={{ background: "oklch(0.16 0.012 260)", border: "1px solid oklch(0.22 0.015 260)" }}>
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">Formato extra #{i + 1}</span>
                        <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setExtraSlots(extraSlots.filter((_, j) => j !== i))} title="Rimuovi formato"><Trash2 className="h-4 w-4 mr-1" />Rimuovi</Button>
                      </div>
                      <ProductSelector selectedProduct={slot.product} onProductSelect={(p) => setExtraSlots(extraSlots.map((x, j) => j === i ? { product: p } : x))} />
                    </div>
                  ))}
                  <Button variant="secondary" className="w-full" onClick={() => setExtraSlots([...extraSlots, {}])}>
                    <Plus className="h-4 w-4 mr-1" />Aggiungi template
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </StepCard>

      <StepCard step={4} title="Crea Prodotti" description="Upload Chunk Protetto + Iniezione in Gelato" isActive={currentStep === 4} isCompleted={createdProducts.length > 0}>
        {currentStep === 4 && selectedProduct && (
          <div className="space-y-8">
            <ProductRules rules={rules} onRulesChange={setRules} onSave={() => toast.success("Regole salvate")} />

            {/* v24: Automazioni post-pubblicazione */}
            <Card style={{ background: "oklch(0.19 0.025 265)", border: "1px solid oklch(0.5 0.12 290)", boxShadow: "0 0 0 1px oklch(0.5 0.12 290 / 0.25), 0 10px 30px oklch(0 0 0 / 0.4)" }}>
              <CardContent className="p-6 space-y-6">
                <div>
                  <h3 className="font-semibold flex items-center gap-2"><Star className="h-4 w-4" />Automazioni post-pubblicazione (opzionali)</h3>
                  <p className="text-xs text-muted-foreground">Applicate in automatico dal worker quando i prodotti compaiono su Shopify. Lascia vuoto ciò che non vuoi usare.</p>
                </div>

                <div className="space-y-1">
                  <label className="text-sm font-medium flex items-center gap-2"><Star className="h-4 w-4" />Badge "Most popular" sulla variante</label>
                  <p className="text-xs text-muted-foreground">Nome esatto della variante/taglia da evidenziare (es. "50x70 cm"). Scrive il metafield custom.most_popular_variant.</p>
                  <Input list="mp-variants" value={mostPopularVariant} placeholder="es. 50x70 cm" style={{ background: "oklch(0.12 0.012 260)" }} onChange={(e) => setMostPopularVariant(e.target.value)} />
                  <datalist id="mp-variants">
                    {(selectedProduct?.variants || []).map((v, i) => <option key={i} value={v} />)}
                  </datalist>
                </div>

                <div className="pt-5" style={{ borderTop: "1px solid oklch(0.34 0.03 265)" }}>
                  <ShopifyProductPicker icon={<Tag className="h-4 w-4" />} label="Copia PREZZI + compare-at da" hint="Prodotto modello da cui copiare prezzo e prezzo barrato per ogni taglia (match per variante)." value={priceRef} onChange={setPriceRef} />
                </div>
                <div className="pt-5" style={{ borderTop: "1px solid oklch(0.34 0.03 265)" }}>
                  <ShopifyProductPicker icon={<Boxes className="h-4 w-4" />} label="Copia INVENTARIO da" hint="Prodotto modello da cui copiare giacenza e tracciamento per ogni taglia (così le varianti non risultano sold out)." value={inventoryRef} onChange={setInventoryRef} />
                </div>
              </CardContent>
            </Card>

            <Card style={{ background: "oklch(0.14 0.015 260)", border: "1px solid oklch(0.35 0.15 145 / 0.3)" }}>
              <CardContent className="p-6 text-center space-y-4">
                <div className="flex items-center justify-center space-x-2 mb-4">
                  <Package className="h-6 w-6 text-green-400" />
                  <h3 className="text-lg font-semibold">Pronto per Creare i Prodotti</h3>
                </div>
                <div className="grid grid-cols-3 gap-4 text-sm text-muted-foreground mb-6">
                  <div><div className="font-medium text-foreground">{images.length}</div><div>File caricati</div></div>
                  <div><div className="font-medium text-foreground">{(template?.variants || []).length || 0}</div><div>Varianti Gelato</div></div>
                  <div><div className="font-medium text-foreground">{totalGroupsCalculated}</div><div>Prodotti finali</div></div>
                </div>
                {isCreating ? (
                  <div className="space-y-4">
                    <div className="flex items-center justify-center space-x-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Upload in corso (chunk sicuri 6MB)…</span>
                    </div>
                    <Progress value={creationProgress} />
                    <p className="text-sm text-muted-foreground">{Math.round(creationProgress)}% completato</p>
                  </div>
                ) : successCount > 0 ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-center space-x-2 text-green-400">
                      <CheckCircle className="h-5 w-5" />
                      <span className="font-medium">Prodotti Creati con Successo!</span>
                    </div>
                    <div className="text-sm text-muted-foreground">{successCount} prodotti nel tuo Store Gelato.</div>
                  </div>
                ) : (
                  <Button onClick={handleCreateProducts} disabled={!images.length || !selectedProduct} size="lg" className="text-white" style={{ background: "var(--gradient-primary)" }}>
                    <Rocket className="h-4 w-4 mr-2" />
                    Crea {totalGroupsCalculated} Prodotti
                  </Button>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </StepCard>
    </div>
  );
}
