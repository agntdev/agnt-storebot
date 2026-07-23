import { kv } from "../lib/kv.js";
import { now } from "../lib/clock.js";
import { newOrderId } from "../lib/ids.js";
import type {
  FulfillmentStatus,
  Order,
  OrderItem,
  PaymentStatus,
} from "../lib/models.js";

const INDEX = "orders:index";
const ORDER_PREFIX = "order:";
const USER_PREFIX = "orders:user:";

function orderKey(id: string): string {
  return ORDER_PREFIX + id;
}

function userKey(userId: number): string {
  return USER_PREFIX + userId;
}

export async function createOrder(input: {
  user_id: number;
  chat_id: number;
  customer_name: string;
  items: OrderItem[];
  total: number;
  shipping_address?: string;
  email?: string;
  payment_status?: PaymentStatus;
  fulfillment_status?: FulfillmentStatus;
}): Promise<Order> {
  const order: Order = {
    order_id: newOrderId(),
    user_id: input.user_id,
    chat_id: input.chat_id,
    customer_name: input.customer_name,
    items: input.items,
    total: input.total,
    payment_status: input.payment_status ?? "pending",
    fulfillment_status: input.fulfillment_status ?? "pending",
    shipping_address: input.shipping_address,
    email: input.email,
    created_at: now(),
    updated_at: now(),
  };
  await kv.set(orderKey(order.order_id), order);

  const index = (await kv.get<string[]>(INDEX)) ?? [];
  index.unshift(order.order_id);
  await kv.set(INDEX, index);

  const userOrders = (await kv.get<string[]>(userKey(order.user_id))) ?? [];
  userOrders.unshift(order.order_id);
  await kv.set(userKey(order.user_id), userOrders);

  return order;
}

export async function getOrder(orderId: string): Promise<Order | undefined> {
  return kv.get<Order>(orderKey(orderId));
}

export async function saveOrder(order: Order): Promise<void> {
  order.updated_at = now();
  await kv.set(orderKey(order.order_id), order);
}

export async function listAllOrderIds(): Promise<string[]> {
  return (await kv.get<string[]>(INDEX)) ?? [];
}

export async function listAllOrders(): Promise<Order[]> {
  const ids = await listAllOrderIds();
  const out: Order[] = [];
  for (const id of ids) {
    const o = await getOrder(id);
    if (o) out.push(o);
  }
  return out;
}

export async function listUserOrders(userId: number): Promise<Order[]> {
  const ids = (await kv.get<string[]>(userKey(userId))) ?? [];
  const out: Order[] = [];
  for (const id of ids) {
    const o = await getOrder(id);
    if (o) out.push(o);
  }
  return out;
}

export async function updatePaymentStatus(
  orderId: string,
  status: PaymentStatus,
  extra?: Partial<Order>,
): Promise<Order | undefined> {
  const order = await getOrder(orderId);
  if (!order) return undefined;
  order.payment_status = status;
  if (extra) Object.assign(order, extra);
  await saveOrder(order);
  return order;
}

export async function updateFulfillmentStatus(
  orderId: string,
  status: FulfillmentStatus,
): Promise<Order | undefined> {
  const order = await getOrder(orderId);
  if (!order) return undefined;
  order.fulfillment_status = status;
  await saveOrder(order);
  return order;
}

export function ordersToCsv(orders: Order[]): string {
  const header =
    "order_id,user_id,customer_name,total_cents,payment_status,fulfillment_status,created_at,items";
  const rows = orders.map((o) => {
    const items = o.items
      .map((i) => `${i.sku}x${i.qty}`)
      .join("|")
      .replace(/"/g, "'");
    return [
      o.order_id,
      o.user_id,
      `"${o.customer_name.replace(/"/g, "'")}"`,
      o.total,
      o.payment_status,
      o.fulfillment_status,
      o.created_at,
      `"${items}"`,
    ].join(",");
  });
  return [header, ...rows].join("\n");
}
