-- SmallBiz POS & Inventory schema
-- Run this entire file in the Supabase SQL Editor.

create extension if not exists "pgcrypto";

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null,
  sku text unique,
  category text,
  unit text default 'pcs',
  cost_price numeric(12,2) not null default 0,
  sell_price numeric(12,2) not null default 0,
  stock_qty numeric(12,2) not null default 0,
  reorder_level numeric(12,2) not null default 0,
  active boolean not null default true
);

create table if not exists stock_movements (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  product_id uuid not null references products(id) on delete cascade,
  movement_type text not null check (movement_type in ('in','out')),
  quantity numeric(12,2) not null check (quantity > 0),
  note text,
  sale_id uuid
);

create table if not exists sales (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  customer text,
  payment_method text default 'cash',
  subtotal numeric(12,2) not null default 0,
  discount numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  profit numeric(12,2) not null default 0
);

create table if not exists sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references sales(id) on delete cascade,
  product_id uuid not null references products(id) on delete restrict,
  product_name text not null,
  quantity numeric(12,2) not null check (quantity > 0),
  unit_price numeric(12,2) not null,
  cost_price numeric(12,2) not null default 0,
  line_total numeric(12,2) not null default 0,
  line_profit numeric(12,2) not null default 0
);

create index if not exists idx_movements_product on stock_movements(product_id, created_at desc);
create index if not exists idx_sales_created on sales(created_at desc);
create index if not exists idx_sale_items_sale on sale_items(sale_id);

alter table products enable row level security;
alter table stock_movements enable row level security;
alter table sales enable row level security;
alter table sale_items enable row level security;

do $$
declare t text;
begin
  foreach t in array array['products','stock_movements','sales','sale_items'] loop
    execute format('drop policy if exists "authenticated full access" on %I', t);
    execute format('create policy "authenticated full access" on %I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

create or replace function create_sale(
  p_items jsonb,
  p_customer text default null,
  p_payment_method text default 'cash',
  p_discount numeric default 0
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale_id uuid;
  v_item jsonb;
  v_product products;
  v_qty numeric;
  v_subtotal numeric := 0;
  v_profit numeric := 0;
begin
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Cart is empty';
  end if;

  insert into sales (customer, payment_method, discount)
  values (p_customer, p_payment_method, p_discount)
  returning id into v_sale_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_product
    from products
    where id = (v_item->>'product_id')::uuid
    for update;

    if not found then
      raise exception 'Product not found';
    end if;

    v_qty := (v_item->>'quantity')::numeric;

    if v_qty <= 0 then
      raise exception 'Quantity must be greater than zero';
    end if;

    if v_product.stock_qty < v_qty then
      raise exception 'Not enough stock for % (available: %)', v_product.name, v_product.stock_qty;
    end if;

    insert into sale_items (
      sale_id, product_id, product_name, quantity,
      unit_price, cost_price, line_total, line_profit
    ) values (
      v_sale_id,
      v_product.id,
      v_product.name,
      v_qty,
      (v_item->>'unit_price')::numeric,
      v_product.cost_price,
      v_qty * (v_item->>'unit_price')::numeric,
      v_qty * ((v_item->>'unit_price')::numeric - v_product.cost_price)
    );

    update products
    set stock_qty = stock_qty - v_qty
    where id = v_product.id;

    insert into stock_movements (product_id, movement_type, quantity, note, sale_id)
    values (v_product.id, 'out', v_qty, 'POS sale', v_sale_id);

    v_subtotal := v_subtotal + (v_qty * (v_item->>'unit_price')::numeric);
    v_profit := v_profit + (v_qty * ((v_item->>'unit_price')::numeric - v_product.cost_price));
  end loop;

  update sales
  set subtotal = v_subtotal,
      total = greatest(v_subtotal - p_discount, 0),
      profit = v_profit - p_discount
  where id = v_sale_id;

  return v_sale_id;
end;
$$;
