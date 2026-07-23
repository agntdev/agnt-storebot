/** Domain entities for the store bot (durable unless noted). */

export interface StoreUser {
  telegram_id: number;
  name: string;
  email?: string;
  shipping_address?: string;
  updated_at: number;
}

export interface Product {
  sku: string;
  title: string;
  price: number; // minor units (cents)
  stock: number;
  variants: string[];
  category: string;
  description?: string;
  created_at: number;
  updated_at: number;
}

export interface CartItem {
  sku: string;
  title: string;
  price: number;
  qty: number;
  variant?: string;
}

export interface Cart {
  user_id: number;
  items: CartItem[];
  updated_at: number;
}

export type PaymentStatus = "pending" | "paid" | "failed" | "refunded";
export type FulfillmentStatus =
  | "pending"
  | "confirmed"
  | "shipped"
  | "delivered"
  | "cancelled";

export interface OrderItem {
  sku: string;
  title: string;
  price: number;
  qty: number;
  variant?: string;
}

export interface Order {
  order_id: string;
  user_id: number;
  chat_id: number;
  customer_name: string;
  items: OrderItem[];
  total: number;
  payment_status: PaymentStatus;
  fulfillment_status: FulfillmentStatus;
  shipping_address?: string;
  email?: string;
  stripe_payment_intent_id?: string;
  created_at: number;
  updated_at: number;
}

export type NotificationType =
  | "order_confirmation"
  | "admin_new_order"
  | "shipping_update"
  | "restock"
  | "broadcast"
  | "sale";

export interface Notification {
  id: string;
  type: NotificationType;
  recipient: number;
  content: string;
  timestamp: number;
}

export type SubNotificationType = "restock" | "sale";

export interface Subscription {
  user_id: number;
  product_sku: string;
  notification_type: SubNotificationType;
  created_at: number;
}

export function cartTotal(items: CartItem[]): number {
  return items.reduce((s, i) => s + i.price * i.qty, 0);
}

export function formatMoney(cents: number, currency = "USD"): string {
  const amount = (cents / 100).toFixed(2);
  if (currency === "USD") return `$${amount}`;
  return `${amount} ${currency}`;
}
