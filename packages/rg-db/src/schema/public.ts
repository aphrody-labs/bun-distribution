import type { Generated } from "kysely";

export interface PublicTables {
  articles: ArticleTable;
  events: CalendarEventTable;
  orders: OrderTable;
}

export interface ArticleTable {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  content: string | null;
  status: "draft" | "published" | "archived";
  app: string;
  category: string | null;
  tags: string[] | null;
  featured_image_url: string | null;
  author_id: string | null;
  created_at: Generated<Date>;
  published_at: Date | null;
  updated_at: Generated<Date>;
}

export interface CalendarEventTable {
  id: Generated<string>;
  title: string;
  description: string | null;
  location: string | null;
  start_time: string;
  end_time: string;
  image_url: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface OrderTable {
  id: Generated<string>;
  stripe_session_id: string;
  stripe_payment_intent_id: string | null;
  stripe_customer_id: string | null;
  user_id: string | null;
  status: string;
  amount_subtotal_cents: number;
  amount_total_cents: number;
  amount_discount_cents: number;
  amount_shipping_cents: number;
  amount_tax_cents: number;
  shipping_name: string | null;
  shipping_email: string | null;
  shipping_phone: string | null;
  shipping_address: Record<string, unknown> | null;
  items: unknown;
  patron_discount_applied: boolean;
  paid_at: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}
