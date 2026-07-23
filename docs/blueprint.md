# Telegram Store Bot — Bot specification

**Archetype:** commerce

**Voice:** professional and concise — write every user-facing message, button label, error, and empty state in this voice.

A compact commerce bot for SMEs to sell products directly in Telegram. Features include product catalog browsing, cart management, payment processing (Telegram + external gateway), order tracking, admin product/order management, and automated notifications for customers and admins.

> This is the complete contract for the bot. Implement EVERY entry point, flow, feature, integration, and edge case below. The completeness review checks the bot against this document after each build pass.

## Primary audience

- customers
- store admins

## Success criteria

- Orders processed with payment confirmation
- Admins can manage products and order statuses
- Automated notifications for order updates and restock alerts

## Entry points

Every feature must be reachable from the bot's command/button surface (button-first; only /start and /help are slash commands).

- **/start** (command, actor: user, command: /start) — Open main menu with Browse/Orders/Subscribe options
- **Browse Products** (button, actor: user, callback: catalog:categories) — View product categories and item listings
  - inputs: category filter
  - outputs: product list
- **View Cart** (button, actor: user, callback: cart:view) — Review cart contents and checkout
  - inputs: cart items
  - outputs: checkout flow
- **Admin Panel** (button, actor: admin, callback: admin:login) — Secure access to product/order management
  - inputs: admin auth token
  - outputs: admin dashboard

## Flows

### Product Purchase
_Trigger:_ catalog:categories

1. Select category
2. View product details
3. Add to cart
4. Checkout
5. Payment confirmation

_Data touched:_ Product, Cart, Order

### Admin Order Management
_Trigger:_ admin:login

1. Verify admin identity
2. Display order list
3. Update order status
4. Generate export

_Data touched:_ Order, Product

### Notification System
_Trigger:_ order_status_change

1. Detect status update
2. Format message
3. Send to customer/admin

_Data touched:_ Notification

## Data entities

Durable data (must survive a restart) uses the toolkit's persistent store, never in-memory maps.

- **User** _(retention: persistent)_ — Customer profile and contact information
  - fields: telegram_id, name, email, shipping_address
- **Product** _(retention: persistent)_ — Catalog item with variants and pricing
  - fields: sku, title, price, stock, variants, category
- **Cart** _(retention: session)_ — Temporary order container
  - fields: user_id, items, totals
- **Order** _(retention: persistent)_ — Completed purchase with fulfillment tracking
  - fields: order_id, items, payment_status, fulfillment_status
- **Notification** _(retention: persistent)_ — System alerts and broadcasts
  - fields: type, recipient, content, timestamp
- **Subscription** _(retention: persistent)_ — Customer opt-in for product alerts
  - fields: user_id, product_sku, notification_type

## Integrations

- **Telegram** (required) — Core messaging and payment interface
- **Payment Gateway** (required) — Telegram Payments + external gateway (e.g., Stripe)
- **Email Service** (optional) — Optional receipt and export delivery
Call external APIs against their real contract (correct endpoints, ids, params); credentials from env. Do not fake responses.

## Owner controls

- Add/Edit/Delete products
- View and update order statuses
- Send broadcast messages
- Export order history as CSV

## Notifications

- Order confirmation to customer
- Admin alert on new order
- Shipping status updates
- Restock/sales alerts based on subscriptions

## Permissions & privacy

- User data only accessible to authorized admins
- Payment info handled by third-party gateway
- Subscriptions require explicit opt-in

## Edge cases

- Out-of-stock items during checkout
- Failed payment retries
- Concurrent cart edits
- Expired order subscriptions

## Required tests

- End-to-end purchase flow with payment success/failure
- Admin product CRUD operations
- Notification delivery across scenarios

## Assumptions

- Default payment gateway is Stripe-like API
- Admin notifications default to single user
- Product variants limited to simple SKUs
