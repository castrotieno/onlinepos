const { createClient } = supabase;
const sb = createClient(window.SB_CONFIG.url, window.SB_CONFIG.anonKey);

let products = [];
let cart = [];
let editingProductId = null;

const $ = (id) => document.getElementById(id);
const money = (n) => Number(n || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
const show = (el) => el.classList.remove('hidden');
const hide = (el) => el.classList.add('hidden');

function toast(msg, isError=false){
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast' + (isError ? ' error' : '');
  show(t);
  setTimeout(() => hide(t), 2600);
}

$('signInBtn').onclick = async () => {
  $('authMsg').textContent = '';
  const { error } = await sb.auth.signInWithPassword({
    email: $('authEmail').value.trim(),
    password: $('authPassword').value
  });
  if (error) $('authMsg').textContent = error.message;
};

$('signUpBtn').onclick = async () => {
  $('authMsg').textContent = '';
  const { error } = await sb.auth.signUp({
    email: $('authEmail').value.trim(),
    password: $('authPassword').value
  });
  $('authMsg').textContent = error ? error.message : 'Check your email to confirm the account, then sign in.';
};

$('signOutBtn').onclick = async () => {
  await sb.auth.signOut();
  hide($('appScreen'));
  show($('authScreen'));
};

sb.auth.onAuthStateChange((_event, session) => {
  if (session) {
    hide($('authScreen'));
    show($('appScreen'));
    refreshAll();
  } else {
    hide($('appScreen'));
    show($('authScreen'));
  }
});

document.querySelectorAll('.tab').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-page').forEach(p => p.classList.add('hidden'));
    btn.classList.add('active');
    show($('tab-' + btn.dataset.tab));
    if (btn.dataset.tab === 'dashboard') loadDashboard();
    if (btn.dataset.tab === 'pos') renderPosProducts();
    if (btn.dataset.tab === 'products') renderProducts();
    if (btn.dataset.tab === 'stock') loadMovements();
    if (btn.dataset.tab === 'sales') loadSales();
  };
});

$('newProductBtn').onclick = () => openProductModal();
$('closeProductBtn').onclick = () => hide($('productModal'));
$('productSearch').oninput = renderProducts;

function openProductModal(product=null){
  editingProductId = product ? product.id : null;
  $('productModalTitle').textContent = product ? 'Edit product' : 'New product';
  $('pName').value = product?.name || '';
  $('pSku').value = product?.sku || '';
  $('pCategory').value = product?.category || '';
  $('pUnit').value = product?.unit || 'pcs';
  $('pCost').value = product?.cost_price ?? '';
  $('pPrice').value = product?.sell_price ?? '';
  $('pStock').value = product?.stock_qty ?? '';
  $('pReorder').value = product?.reorder_level ?? '';
  $('productMsg').textContent = '';
  show($('productModal'));
}

$('saveProductBtn').onclick = async () => {
  const payload = {
    name: $('pName').value.trim(),
    sku: $('pSku').value.trim() || null,
    category: $('pCategory').value.trim() || null,
    unit: $('pUnit').value.trim() || 'pcs',
    cost_price: Number($('pCost').value || 0),
    sell_price: Number($('pPrice').value || 0),
    stock_qty: Number($('pStock').value || 0),
    reorder_level: Number($('pReorder').value || 0)
  };
  if (!payload.name) { $('productMsg').textContent = 'Product name is required.'; return; }

  const { error } = editingProductId
    ? await sb.from('products').update(payload).eq('id', editingProductId)
    : await sb.from('products').insert(payload);

  if (error) { $('productMsg').textContent = error.message; return; }
  hide($('productModal'));
  toast('Product saved');
  await loadProducts();
  renderProducts();
  renderPosProducts();
};

async function loadProducts(){
  const { data, error } = await sb.from('products').select('*').order('name');
  if (error) { toast(error.message, true); return; }
  products = data || [];
  $('kpiProducts').textContent = products.length;
  $('kpiLow').textContent = products.filter(p => Number(p.stock_qty) <= Number(p.reorder_level)).length;
}

function renderProducts(){
  const q = $('productSearch').value.toLowerCase();
  const rows = products.filter(p =>
    !q || p.name.toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q)
  );
  $('productsTable').querySelector('tbody').innerHTML = rows.map(p => `
    <tr>
      <td>${esc(p.name)}</td>
      <td>${esc(p.sku || '-')}</td>
      <td>${esc(p.category || '-')}</td>
      <td>${money(p.cost_price)}</td>
      <td>${money(p.sell_price)}</td>
      <td class="${Number(p.stock_qty) <= Number(p.reorder_level) ? 'low' : ''}">${p.stock_qty} ${esc(p.unit || '')}</td>
      <td>${p.reorder_level}</td>
      <td>
        <button class="ghost small" onclick='editProduct(${JSON.stringify(p).replaceAll("'", "&#39;")})'>Edit</button>
        <button class="ghost small" onclick="deleteProduct('${p.id}')">Delete</button>
      </td>
    </tr>`).join('');
}

function editProduct(p){ openProductModal(p); }

async function deleteProduct(id){
  if (!confirm('Delete this product? Its stock history will also be deleted.')) return;
  const { error } = await sb.from('products').delete().eq('id', id);
  if (error) return toast(error.message, true);
  toast('Product deleted');
  await loadProducts();
  renderProducts();
  renderPosProducts();
}

$('newMovementBtn').onclick = async () => {
  await loadProducts();
  $('mProduct').innerHTML = products.map(p =>
    `<option value="${p.id}">${esc(p.name)} — stock: ${p.stock_qty}</option>`).join('');
  $('mQty').value = '';
  $('mNote').value = '';
  $('movementMsg').textContent = '';
  show($('movementModal'));
};

$('closeMovementBtn').onclick = () => hide($('movementModal'));

$('saveMovementBtn').onclick = async () => {
  const payload = {
    product_id: $('mProduct').value,
    movement_type: $('mType').value,
    quantity: Number($('mQty').value),
    note: $('mNote').value.trim() || null
  };
  if (!payload.product_id || !(payload.quantity > 0)) {
    $('movementMsg').textContent = 'Select a product and enter a quantity greater than zero.';
    return;
  }

  const { data: product } = await sb.from('products').select('stock_qty,name').eq('id', payload.product_id).single();
  if (payload.movement_type === 'out' && Number(product.stock_qty) < payload.quantity) {
    $('movementMsg').textContent = `Not enough stock. Available: ${product.stock_qty}`;
    return;
  }

  const { error } = await sb.from('stock_movements').insert(payload);
  if (error) { $('movementMsg').textContent = error.message; return; }

  const newQty = payload.movement_type === 'in'
    ? Number(product.stock_qty) + payload.quantity
    : Number(product.stock_qty) - payload.quantity;

  await sb.from('products').update({ stock_qty: newQty }).eq('id', payload.product_id);

  hide($('movementModal'));
  toast('Stock movement saved');
  await loadProducts();
  loadMovements();
  renderProducts();
};

async function loadMovements(){
  const { data, error } = await sb.from('stock_movements')
    .select('*, products(name,unit)')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) return toast(error.message, true);

  $('movementsTable').querySelector('tbody').innerHTML = (data || []).map(m => `
    <tr>
      <td>${new Date(m.created_at).toLocaleString()}</td>
      <td>${esc(m.products?.name || '-')}</td>
      <td class="${m.movement_type === 'in' ? 'in' : 'out'}">${m.movement_type === 'in' ? 'Stock In' : 'Stock Out'}</td>
      <td>${m.quantity}</td>
      <td>${esc(m.note || '-')}</td>
    </tr>`).join('');
}

$('posSearch').oninput = renderPosProducts;

function renderPosProducts(){
  const q = $('posSearch').value.toLowerCase();
  const list = products.filter(p =>
    p.active !== false && (!q || p.name.toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q))
  );
  $('posProducts').innerHTML = list.map(p => `
    <button class="pos-product" onclick="addToCart('${p.id}')">
      <strong>${esc(p.name)}</strong>
      <span class="price">${money(p.sell_price)}</span>
      <span class="stock">Stock: ${p.stock_qty} ${esc(p.unit || '')}</span>
    </button>`).join('') || '<p class="muted">No products found.</p>';
}

function addToCart(id){
  const p = products.find(x => x.id === id);
  if (!p) return;
  const existing = cart.find(c => c.product_id === id);
  const currentQty = existing ? existing.quantity : 0;

  if (currentQty + 1 > Number(p.stock_qty)) return toast(`Only ${p.stock_qty} ${p.unit || ''} available`, true);

  if (existing) existing.quantity += 1;
  else cart.push({ product_id: p.id, name: p.name, unit_price: Number(p.sell_price), quantity: 1 });

  renderCart();
}

function removeFromCart(id){
  cart = cart.filter(c => c.product_id !== id);
  renderCart();
}

function renderCart(){
  const tbody = $('cartTable').querySelector('tbody');
  tbody.innerHTML = cart.map(c => `
    <tr>
      <td>${esc(c.name)}</td>
      <td>${c.quantity}</td>
      <td>${money(c.unit_price)}</td>
      <td>${money(c.quantity * c.unit_price)}</td>
      <td><button class="ghost small" onclick="removeFromCart('${c.product_id}')">✕</button></td>
    </tr>`).join('');

  const subtotal = cart.reduce((s, c) => s + c.quantity * c.unit_price, 0);
  const discount = Number($('cartDiscount').value || 0);
  $('cartSubtotal').textContent = money(subtotal);
  $('cartTotal').textContent = money(Math.max(subtotal - discount, 0));
}

$('cartDiscount').oninput = renderCart;
$('clearCartBtn').onclick = () => { cart = []; renderCart(); };

$('checkoutBtn').onclick = async () => {
  if (!cart.length) return toast('Cart is empty', true);

  const items = cart.map(c => ({
    product_id: c.product_id,
    quantity: c.quantity,
    unit_price: c.unit_price
  }));

  const { data, error } = await sb.rpc('create_sale', {
    p_items: items,
    p_customer: $('cartCustomer').value.trim() || null,
    p_payment_method: $('cartPayment').value,
    p_discount: Number($('cartDiscount').value || 0)
  });

  if (error) return toast(error.message, true);

  cart = [];
  $('cartCustomer').value = '';
  $('cartDiscount').value = 0;
  renderCart();
  toast('Sale completed');
  await loadProducts();
  renderPosProducts();
  loadDashboard();
};

async function loadSales(){
  const { data, error } = await sb.from('sales')
    .select('*, sale_items(quantity, product_name)')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) return toast(error.message, true);

  $('salesTable').querySelector('tbody').innerHTML = (data || []).map(s => `
    <tr>
      <td>${new Date(s.created_at).toLocaleString()}</td>
      <td>${esc(s.customer || 'Walk-in')}</td>
      <td>${esc(s.payment_method || '-')}</td>
      <td>${(s.sale_items || []).reduce((a, i) => a + Number(i.quantity), 0)}</td>
      <td>${money(s.total)}</td>
      <td class="profit">${money(s.profit)}</td>
    </tr>`).join('');
}

async function loadDashboard(){
  await loadProducts();
  renderProducts();
  renderPosProducts();

  const start = new Date();
  start.setHours(0,0,0,0);

  const { data: sales, error } = await sb.from('sales')
    .select('total, profit, created_at')
    .gte('created_at', start.toISOString());

  if (!error) {
    const todaySales = (sales || []).reduce((a, s) => a + Number(s.total || 0), 0);
    const todayProfit = (sales || []).reduce((a, s) => a + Number(s.profit || 0), 0);
    $('kpiSales').textContent = money(todaySales);
    $('kpiProfit').textContent = money(todayProfit);
  }

  const low = products.filter(p => Number(p.stock_qty) <= Number(p.reorder_level));
  $('lowStockTable').querySelector('tbody').innerHTML = low.map(p => `
    <tr>
      <td>${esc(p.name)}</td>
      <td>${esc(p.sku || '-')}</td>
      <td>${p.stock_qty}</td>
      <td>${p.reorder_level}</td>
    </tr>`).join('') || '<tr><td colspan="4" class="muted">No products need reordering.</td></tr>';
}

function refreshAll(){
  loadDashboard();
  loadMovements();
  loadSales();
}

function esc(s){
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[c]);
}
