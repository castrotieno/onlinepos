-- SmallBiz POS & Inventory Manager v2
-- Run this entire file in Supabase SQL Editor.

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
create index if not exists idx_products_name on products(name);

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

-- Atomic sale creation
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
    select * into v_product from products where id = (v_item->>'product_id')::uuid for update;

    if not found then raise exception 'Product not found'; end if;

    v_qty := (v_item->>'quantity')::numeric;

    if v_qty <= 0 then raise exception 'Quantity must be greater than zero'; end if;
    if v_product.stock_qty < v_qty then
      raise exception 'Not enough stock for % (available: %)', v_product.name, v_product.stock_qty;
    end if;

    insert into sale_items (
      sale_id, product_id, product_name, quantity,
      unit_price, cost_price, line_total, line_profit
    ) values (
      v_sale_id, v_product.id, v_product.name, v_qty,
      (v_item->>'unit_price')::numeric, v_product.cost_price,
      v_qty * (v_item->>'unit_price')::numeric,
      v_qty * ((v_item->>'unit_price')::numeric - v_product.cost_price)
    );

    update products set stock_qty = stock_qty - v_qty where id = v_product.id;

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

-- Delete a sale and restore stock
create or replace function delete_sale(p_sale_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item record;
begin
  for v_item in
    select si.product_id, si.quantity
    from sale_items si
    where si.sale_id = p_sale_id
  loop
    update products
    set stock_qty = stock_qty + v_item.quantity
    where id = v_item.product_id;

    insert into stock_movements (product_id, movement_type, quantity, note, sale_id)
    values (v_item.product_id, 'in', v_item.quantity, 'Sale deleted - stock restored', p_sale_id);
  end loop;

  delete from sales where id = p_sale_id;
end;
$$;

-- Load realistic sample data
create or replace function seed_sample_data()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  p1 uuid; p2 uuid; p3 uuid; p4 uuid; p5 uuid; p6 uuid; p7 uuid; p8 uuid;
  s1 uuid; s2 uuid; s3 uuid; s4 uuid; s5 uuid;
begin
  if exists (select 1 from products) then
    raise exception 'Products already exist. Use Reset data first if you want fresh sample data.';
  end if;

  insert into products (name, sku, category, unit, cost_price, sell_price, stock_qty, reorder_level)
  values
    ('Rice 5kg', 'RICE-5KG', 'Groceries', 'bag', 8.00, 11.50, 40, 10) returning id into p1;
  insert into products (name, sku, category, unit, cost_price, sell_price, stock_qty, reorder_level)
  values ('Cooking Oil 1L', 'OIL-1L', 'Groceries', 'bottle', 2.20, 3.50, 35, 12) returning id into p2;
  insert into products (name, sku, category, unit, cost_price, sell_price, stock_qty, reorder_level)
  values ('Sugar 1kg', 'SUGAR-1KG', 'Groceries', 'packet', 1.10, 1.80, 50, 15) returning id into p3;
  insert into products (name, sku, category, unit, cost_price, sell_price, stock_qty, reorder_level)
  values ('Milk 500ml', 'MILK-500', 'Dairy', 'packet', 0.70, 1.20, 24, 10) returning id into p4;
  insert into products (name, sku, category, unit, cost_price, sell_price, stock_qty, reorder_level)
  values ('Bread Loaf', 'BREAD-01', 'Bakery', 'pcs', 0.80, 1.40, 8, 10) returning id into p5;
  insert into products (name, sku, category, unit, cost_price, sell_price, stock_qty, reorder_level)
  values ('Eggs Tray', 'EGGS-30', 'Dairy', 'tray', 4.50, 6.00, 18, 6) returning id into p6;
  insert into products (name, sku, category, unit, cost_price, sell_price, stock_qty, reorder_level)
  values ('Soap Bar', 'SOAP-01', 'Household', 'pcs', 0.45, 0.90, 60, 20) returning id into p7;
  insert into products (name, sku, category, unit, cost_price, sell_price, stock_qty, reorder_level)
  values ('Drinking Water 1L', 'WATER-1L', 'Beverages', 'bottle', 0.25, 0.60, 90, 24) returning id into p8;

  insert into stock_movements (product_id, movement_type, quantity, note, created_at)
  values
    (p1, 'in', 50, 'Opening stock', now() - interval '9 days'),
    (p2, 'in', 50, 'Opening stock', now() - interval '9 days'),
    (p3, 'in', 80, 'Opening stock', now() - interval '9 days'),
    (p4, 'in', 40, 'Opening stock', now() - interval '9 days'),
    (p5, 'in', 30, 'Opening stock', now() - interval '9 days'),
    (p6, 'in', 25, 'Opening stock', now() - interval '9 days'),
    (p7, 'in', 100, 'Opening stock', now() - interval '9 days'),
    (p8, 'in', 150, 'Opening stock', now() - interval '9 days');

  -- Sample sale 1
  insert into sales (customer, payment_method, subtotal, discount, total, profit, created_at)
  values ('Walk-in', 'cash', 19.40, 0, 19.40, 6.30, now() - interval '6 days')
  returning id into s1;

  insert into sale_items (sale_id, product_id, product_name, quantity, unit_price, cost_price, line_total, line_profit)
  values
    (s1, p1, 'Rice 5kg', 1, 11.50, 8.00, 11.50, 3.50),
    (s1, p3, 'Sugar 1kg', 2, 1.80, 1.10, 3.60, 1.40),
    (s1, p8, 'Drinking Water 1L', 3, 0.60, 0.25, 1.80, 1.05),
    (s1, p7, 'Soap Bar', 2, 0.90, 0.45, 1.80, 0.90),
    (s1, p4, 'Milk 500ml', 1, 1.20, 0.70, 1.20, 0.50);

  update products set stock_qty = stock_qty - 1 where id = p1;
  update products set stock_qty = stock_qty - 2 where id = p3;
  update products set stock_qty = stock_qty - 3 where id = p8;
  update products set stock_qty = stock_qty - 2 where id = p7;
  update products set stock_qty = stock_qty - 1 where id = p4;

  insert into stock_movements (product_id, movement_type, quantity, note, sale_id, created_at)
  values
    (p1, 'out', 1, 'POS sale', s1, now() - interval '6 days'),
    (p3, 'out', 2, 'POS sale', s1, now() - interval '6 days'),
    (p8, 'out', 3, 'POS sale', s1, now() - interval '6 days'),
    (p7, 'out', 2, 'POS sale', s1, now() - interval '6 days'),
    (p4, 'out', 1, 'POS sale', s1, now() - interval '6 days');

  -- Sample sale 2
  insert into sales (customer, payment_method, subtotal, discount, total, profit, created_at)
  values ('Amina Hassan', 'mobile', 13.20, 0.50, 12.70, 3.85, now() - interval '4 days')
  returning id into s2;

  insert into sale_items (sale_id, product_id, product_name, quantity, unit_price, cost_price, line_total, line_profit)
  values
    (s2, p2, 'Cooking Oil 1L', 2, 3.50, 2.20, 7.00, 2.60),
    (s2, p6, 'Eggs Tray', 1, 6.00, 4.50, 6.00, 1.50);

  update products set stock_qty = stock_qty - 2 where id = p2;
  update products set stock_qty = stock_qty - 1 where id = p6;

  insert into stock_movements (product_id, movement_type, quantity, note, sale_id, created_at)
  values
    (p2, 'out', 2, 'POS sale', s2, now() - interval '4 days'),
    (p6, 'out', 1, 'POS sale', s2, now() - interval '4 days');

  -- Sample sale 3
  insert into sales (customer, payment_method, subtotal, discount, total, profit, created_at)
  values ('Walk-in', 'card', 8.40, 0, 8.40, 2.70, now() - interval '2 days')
  returning id into s3;

  insert into sale_items (sale_id, product_id, product_name, quantity, unit_price, cost_price, line_total, line_profit)
  values
    (s3, p5, 'Bread Loaf', 3, 1.40, 0.80, 4.20, 1.80),
    (s3, p4, 'Milk 500ml', 2, 1.20, 0.70, 2.40, 1.00),
    (s3, p8, 'Drinking Water 1L', 3, 0.60, 0.25, 1.80, 1.05);

  update products set stock_qty = stock_qty - 3 where id = p5;
  update products set stock_qty = stock_qty - 2 where id = p4;
  update products set stock_qty = stock_qty - 3 where id = p8;

  insert into stock_movements (product_id, movement_type, quantity, note, sale_id, created_at)
  values
    (p5, 'out', 3, 'POS sale', s3, now() - interval '2 days'),
    (p4, 'out', 2, 'POS sale', s3, now() - interval '2 days'),
    (p8, 'out', 3, 'POS sale', s3, now() - interval '2 days');

  -- Sample sale 4: today
  insert into sales (customer, payment_method, subtotal, discount, total, profit, created_at)
  values ('John Mwangi', 'cash', 17.30, 1.00, 16.30, 5.45, now() - interval '3 hours')
  returning id into s4;

  insert into sale_items (sale_id, product_id, product_name, quantity, unit_price, cost_price, line_total, line_profit)
  values
    (s4, p1, 'Rice 5kg', 1, 11.50, 8.00, 11.50, 3.50),
    (s4, p2, 'Cooking Oil 1L', 1, 3.50, 2.20, 3.50, 1.30),
    (s4, p3, 'Sugar 1kg', 1, 1.80, 1.10, 1.80, 0.70),
    (s4, p8, 'Drinking Water 1L', 1, 0.60, 0.25, 0.60, 0.35);

  update products set stock_qty = stock_qty - 1 where id = p1;
  update products set stock_qty = stock_qty - 1 where id = p2;
  update products set stock_qty = stock_qty - 1 where id = p3;
  update products set stock_qty = stock_qty - 1 where id = p8;

  insert into stock_movements (product_id, movement_type, quantity, note, sale_id, created_at)
  values
    (p1, 'out', 1, 'POS sale', s4, now() - interval '3 hours'),
    (p2, 'out', 1, 'POS sale', s4, now() - interval '3 hours'),
    (p3, 'out', 1, 'POS sale', s4, now() - interval '3 hours'),
    (p8, 'out', 1, 'POS sale', s4, now() - interval '3 hours');

  -- Sample sale 5: today
  insert into sales (customer, payment_method, subtotal, discount, total, profit, created_at)
  values ('Grace Otieno', 'mobile', 7.20, 0, 7.20, 2.55, now() - interval '1 hour')
  returning id into s5;

  insert into sale_items (sale_id, product_id, product_name, quantity, unit_price, cost_price, line_total, line_profit)
  values
    (s4, p5, 'Bread Loaf', 2, 1.40, 0.80, 2.80, 1.20),
    (s5, p6, 'Eggs Tray', 1, 6.00, 4.50, 6.00, 1.50);

  -- Correct the first item to belong to s5
  delete from sale_items where sale_id = s4 and product_id = p5 and quantity = 2;

  update products set stock_qty = stock_qty - 2 where id = p5;
  update products set stock_qty = stock_qty - 1 where id = p6;

  insert into stock_movements (product_id, movement_type, quantity, note, sale_id, created_at)
  values
    (p5, 'out', 2, 'POS sale', s5, now() - interval '1 hour'),
    (p6, 'out', 1, 'POS sale', s5, now() - interval '1 hour');
end;
$$;

-- Reset all business data
create or replace function reset_all_data()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from sale_items;
  delete from sales;
  delete from stock_movements;
  delete from products;
end;
$$;
