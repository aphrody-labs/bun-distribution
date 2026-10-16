-- Migration : table `orders` pour le shop Stripe Rose Griffon.
-- À appliquer côté Supabase via SQL editor ou `supabase db push`.
--
-- Conception :
--   - Source de vérité = Stripe (session_id + customer_id + payment_intent_id).
--     Cette table est un MIROIR local pour permettre l'historique côté user
--     dashboard ("Mes commandes") sans frapper l'API Stripe à chaque load.
--   - Le webhook `checkout.session.completed` upsert la ligne.
--   - RLS active : l'utilisateur ne peut lire QUE ses propres commandes.
--     L'admin a un policy bypass via `is_admin()`.

CREATE TABLE IF NOT EXISTS public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text REFERENCES public."user"(id) ON DELETE SET NULL,  -- Better Auth utilise text IDs (CUID/nanoid)
  stripe_session_id text UNIQUE NOT NULL,
  stripe_customer_id text,
  stripe_payment_intent_id text,

  -- Snapshot financier au moment du paiement (cents EUR)
  amount_subtotal_cents integer NOT NULL DEFAULT 0,
  amount_discount_cents integer NOT NULL DEFAULT 0,
  amount_shipping_cents integer NOT NULL DEFAULT 0,
  amount_tax_cents integer NOT NULL DEFAULT 0,
  amount_total_cents integer NOT NULL,

  -- Drapeaux discount
  patron_discount_applied boolean NOT NULL DEFAULT false,
  promotion_code text,

  -- Adresse livraison snapshot (JSON Stripe shipping_details)
  shipping_address jsonb,
  shipping_name text,
  shipping_email text,
  shipping_phone text,

  -- Snapshot du panier (id, slug, variantId, qty, unit_amount, label)
  items jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Cycle de vie commande
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'shipped', 'delivered', 'refunded', 'failed', 'canceled')),
  tracking_number text,
  tracking_carrier text,

  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  shipped_at timestamptz,
  delivered_at timestamptz,
  refunded_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes pour les queries fréquentes
CREATE INDEX IF NOT EXISTS orders_user_id_created_at_idx
  ON public.orders (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS orders_status_idx
  ON public.orders (status)
  WHERE status IN ('pending', 'paid', 'shipped');

CREATE INDEX IF NOT EXISTS orders_stripe_customer_id_idx
  ON public.orders (stripe_customer_id);

-- Trigger updated_at
CREATE OR REPLACE FUNCTION public.set_orders_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS orders_updated_at_trigger ON public.orders;
CREATE TRIGGER orders_updated_at_trigger
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.set_orders_updated_at();

-- RLS : user lit ses propres commandes, admin lit tout
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "orders_select_own" ON public.orders;
CREATE POLICY "orders_select_own" ON public.orders
  FOR SELECT
  USING (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "orders_select_admin" ON public.orders;
CREATE POLICY "orders_select_admin" ON public.orders
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id::text = auth.uid()::text
        AND role IN ('admin', 'superadmin')
    )
  );

-- Insert/update réservé au service role (webhook Stripe)
DROP POLICY IF EXISTS "orders_service_role_all" ON public.orders;
CREATE POLICY "orders_service_role_all" ON public.orders
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

COMMENT ON TABLE public.orders IS
  'Miroir local des Checkout Sessions Stripe pour /shop/commandes. Source de vérité = Stripe.';
COMMENT ON COLUMN public.orders.items IS
  'Snapshot panier : [{slug, variantId, qty, unit_amount_cents, label, image}]';
COMMENT ON COLUMN public.orders.shipping_address IS
  'Stripe shipping_details.address : {line1, line2, city, state, postal_code, country}';
