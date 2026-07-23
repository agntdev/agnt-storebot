import { kv } from "../lib/kv.js";
import { now } from "../lib/clock.js";
import type { Product } from "../lib/models.js";

const INDEX = "products:index";
const CAT_PREFIX = "products:cat:";
const PRODUCT_PREFIX = "product:";

function productKey(sku: string): string {
  return PRODUCT_PREFIX + sku;
}

function catKey(category: string): string {
  return CAT_PREFIX + category.toLowerCase();
}

export async function listProductSkus(): Promise<string[]> {
  return (await kv.get<string[]>(INDEX)) ?? [];
}

export async function getProduct(sku: string): Promise<Product | undefined> {
  return kv.get<Product>(productKey(sku));
}

export async function listProducts(): Promise<Product[]> {
  const skus = await listProductSkus();
  const out: Product[] = [];
  for (const sku of skus) {
    const p = await getProduct(sku);
    if (p) out.push(p);
  }
  return out;
}

export async function listCategories(): Promise<string[]> {
  const products = await listProducts();
  const set = new Set<string>();
  for (const p of products) set.add(p.category);
  return [...set].sort((a, b) => a.localeCompare(b));
}

export async function listByCategory(category: string): Promise<Product[]> {
  const skus = (await kv.get<string[]>(catKey(category))) ?? [];
  const out: Product[] = [];
  for (const sku of skus) {
    const p = await getProduct(sku);
    if (p && p.category.toLowerCase() === category.toLowerCase()) out.push(p);
  }
  return out;
}

export async function upsertProduct(
  input: Omit<Product, "created_at" | "updated_at"> & {
    created_at?: number;
    updated_at?: number;
  },
): Promise<Product> {
  const existing = await getProduct(input.sku);
  const product: Product = {
    sku: input.sku,
    title: input.title,
    price: input.price,
    stock: input.stock,
    variants: input.variants ?? [],
    category: input.category,
    description: input.description,
    created_at: existing?.created_at ?? input.created_at ?? now(),
    updated_at: now(),
  };

  await kv.set(productKey(product.sku), product);

  const index = (await kv.get<string[]>(INDEX)) ?? [];
  if (!index.includes(product.sku)) {
    index.push(product.sku);
    await kv.set(INDEX, index);
  }

  // Maintain category index (remove from old category if changed)
  if (existing && existing.category.toLowerCase() !== product.category.toLowerCase()) {
    const oldSkus = (await kv.get<string[]>(catKey(existing.category))) ?? [];
    await kv.set(
      catKey(existing.category),
      oldSkus.filter((s) => s !== product.sku),
    );
  }
  const catSkus = (await kv.get<string[]>(catKey(product.category))) ?? [];
  if (!catSkus.includes(product.sku)) {
    catSkus.push(product.sku);
    await kv.set(catKey(product.category), catSkus);
  }

  return product;
}

export async function deleteProduct(sku: string): Promise<boolean> {
  const existing = await getProduct(sku);
  if (!existing) return false;
  await kv.delete(productKey(sku));
  const index = (await kv.get<string[]>(INDEX)) ?? [];
  await kv.set(
    INDEX,
    index.filter((s) => s !== sku),
  );
  const catSkus = (await kv.get<string[]>(catKey(existing.category))) ?? [];
  await kv.set(
    catKey(existing.category),
    catSkus.filter((s) => s !== sku),
  );
  return true;
}

/** Atomically try to reserve stock. Returns false if insufficient. */
export async function reserveStock(
  items: ReadonlyArray<{ sku: string; qty: number }>,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  // Read all first
  const products: Product[] = [];
  for (const item of items) {
    const p = await getProduct(item.sku);
    if (!p) return { ok: false, reason: `Product ${item.sku} is no longer available.` };
    if (p.stock < item.qty) {
      return {
        ok: false,
        reason: `"${p.title}" only has ${p.stock} left — remove some from your cart and try again.`,
      };
    }
    products.push(p);
  }
  // Decrement
  for (let i = 0; i < items.length; i++) {
    const p = products[i]!;
    const item = items[i]!;
    p.stock -= item.qty;
    p.updated_at = now();
    await kv.set(productKey(p.sku), p);
  }
  return { ok: true };
}

export async function restoreStock(
  items: ReadonlyArray<{ sku: string; qty: number }>,
): Promise<void> {
  for (const item of items) {
    const p = await getProduct(item.sku);
    if (!p) continue;
    p.stock += item.qty;
    p.updated_at = now();
    await kv.set(productKey(p.sku), p);
  }
}

export async function setStock(sku: string, stock: number): Promise<Product | undefined> {
  const p = await getProduct(sku);
  if (!p) return undefined;
  const prev = p.stock;
  p.stock = stock;
  p.updated_at = now();
  await kv.set(productKey(sku), p);
  return { ...p, stock: prev }; // return previous for restock detection via caller
}

export async function adjustStock(sku: string, stock: number): Promise<{ product: Product; wasZero: boolean } | undefined> {
  const p = await getProduct(sku);
  if (!p) return undefined;
  const wasZero = p.stock <= 0;
  p.stock = stock;
  p.updated_at = now();
  await kv.set(productKey(sku), p);
  return { product: p, wasZero };
}
