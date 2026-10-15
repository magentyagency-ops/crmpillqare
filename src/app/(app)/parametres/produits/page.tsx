import { requireRole } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { toNumber } from "@/lib/format";
import { SectionCard } from "@/components/common/ui-bits";
import { ProductsEditor } from "./products-client";

export const metadata = { title: "Produits" };

export default async function ProductsPage() {
  await requireRole("ADMIN", "MANAGER");
  const products = await db.product.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }] });
  return (
    <SectionCard title="Produits et tarifs" description="Catalogue utilisé dans les devis et les essais. Les produits Shopify sont rapprochés par variante ou SKU (import complet dans Intégrations).">
      <ProductsEditor
        products={products.map((p) => ({
          id: p.id,
          name: p.name,
          sku: p.sku ?? "",
          description: p.description ?? "",
          type: p.type,
          unitPriceHT: String(toNumber(p.unitPriceHT)),
          vatRate: String(toNumber(p.vatRate)),
          unit: p.unit,
          active: p.active,
          shopifyVariantId: p.shopifyVariantId ?? "",
        }))}
      />
    </SectionCard>
  );
}
