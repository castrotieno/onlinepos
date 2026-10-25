const { createClient } = supabase;
const sb = createClient(window.SB_CONFIG.url, window.SB_CONFIG.anonKey);

let products = [];
let cart = [];
let currentSale = null;
let reportData = null;

const $ = id => document.getElementById(id);
const money = n => Number(n || 0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
const show = el => el.classList.remove('hidden');
const hide = el => el.classList.add('hidden');
const todayISO = () => new Date().toISOString().slice(0,10);

function toast(msg, isError=false){
  const t=$('toast'); t.textContent=msg;
  t.className='toast'+(isError?' error':''); show(t);
  setTimeout(()=>hide(t),2800);
}

function esc(s){
  return String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
}

/* ---------- AUTH ---------- */
$('signInBtn').onclick = async () => {
  $('authMsg').textContent='';
  const {error}=await sb.auth.signInWithPassword({email:$('authEmail').value.trim(),password:$('authPassword').value});
  if(error) $('authMsg').textContent=error.message;
};

$('signUpBtn').onclick = async () => {
  $('authMsg').textContent='';
  const {error}=await sb.auth.signUp({email:$('authEmail').value.trim(),password:$('authPassword').value});
  $('authMsg').textContent = error ? error.message : 'Check your email to confirm the account, then sign in.';
};

$('signOutBtn').onclick = async () => {
  await sb.auth.signOut();
  hide($('appScreen')); show($('authScreen'));
};

sb.auth.onAuthStateChange((_e,session)=>{
  if(session){ hide($('authScreen')); show($('appScreen')); refreshAll(); }
  else { hide($('appScreen')); show($('authScreen')); }
});

/* ---------- NAV ---------- */
const titles={
  dashboard:['Dashboard','Business overview'],
  pos:['Point of Sale','Create a new sale'],
  products:['Products','Manage your catalog'],
  stock:['Stock','Track stock in and stock out'],
  sales:['Sales Log','Manage and reprint sales'],
  reports:['Reports','Generate and print business reports']
};

document.querySelectorAll('.nav-item').forEach(btn=>{
  btn.onclick=()=>{
    document.querySelectorAll('.nav-item').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v=>v.classList.add('hidden'));
    btn.classList.add('active');
    show($('view-'+btn.dataset.view));
    const [t,s]=titles[btn.dataset.view];
    $('pageTitle').textContent=t; $('pageSubtitle').textContent=s;
    if(btn.dataset.view==='dashboard') loadDashboard();
    if(btn.dataset.view==='pos') renderPos();
    if(btn.dataset.view==='products') renderProducts();
    if(btn.dataset.view==='stock') loadMovements();
    if(btn.dataset.view==='sales') loadSales();
    if(btn.dataset.view==='reports') generateReport();
  };
});

document.querySelectorAll('[data-goto]').forEach(b=>{
  b.onclick=()=>document.querySelector(`.nav-item[data-view="${b.dataset.goto}"]`).click();
});

$('refreshBtn').onclick=()=>{refreshAll();toast('Data refreshed');};

$('sampleDataBtn').onclick=async()=>{
  if(!confirm('Load sample products and demo sales? This will fail if products already exist.'))return;
  const {error}=await sb.rpc('seed_sample_data');
  if(error)return toast(error.message,true);
  toast('Sample data loaded');
  refreshAll();
};

$('resetDataBtn').onclick=async()=>{
  if(!confirm('Permanently delete ALL products, stock history, sales, and sale items?'))return;
  if(!confirm('This cannot be undone. Continue?'))return;
  const {error}=await sb.rpc('reset_all_data');
  if(error)return toast(error.message,true);
  toast('All business data reset');
  refreshAll();
};

/* ---------- DATA ---------- */
async function loadProducts(){
  const {data,error}=await sb.from('products').select('*').order('name');
  if(error){toast(error.message,true);return;}
  products=data||[];
}

async function refreshAll(){
  await loadProducts();
  loadDashboard(); loadMovements(); loadSales(); renderProducts(); renderPos();
}

/* ---------- DASHBOARD ---------- */
async function loadDashboard(){
  await loadProducts();
  renderProducts(); renderPos();

  const start=new Date(); start.setHours(0,0,0,0);
  const {data:sales,error}=await sb.from('sales')
    .select('*, sale_items(quantity)')
    .gte('created_at',start.toISOString())
    .order('created_at',{ascending:false});

  if(!error){
    const list=sales||[];
    $('kpiRevenue').textContent=money(list.reduce((a,s)=>a+Number(s.total),0));
    $('kpiProfit').textContent=money(list.reduce((a,s)=>a+Number(s.profit),0));
    $('kpiTransactions').textContent=list.length;
    $('kpiItemsSold').textContent=list.reduce((a,s)=>a+(s.sale_items||[]).reduce((x,i)=>x+Number(i.quantity),0),0);

    $('recentSalesTable').querySelector('tbody').innerHTML=list.slice(0,8).map(s=>`
      <tr><td>${new Date(s.created_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</td>
      <td>${esc(s.customer||'Walk-in')}</td><td>${money(s.total)}</td>
      <td class="profit">${money(s.profit)}</td></tr>`).join('') ||
      '<tr><td colspan="4" class="muted">No sales yet today.</td></tr>';
  }

  const low=products.filter(p=>Number(p.stock_qty)<=Number(p.reorder_level));
  $('lowCount').textContent=low.length+' items';
  $('lowStockTable').querySelector('tbody').innerHTML=low.map(p=>{
    const status=Number(p.stock_qty)<=0?'Out of stock':'Low stock';
    const cls=Number(p.stock_qty)<=0?'out':'low';
    return `<tr><td>${esc(p.name)}</td><td>${p.stock_qty} ${esc(p.unit||'')}</td>
    <td>${p.reorder_level}</td><td><span class="badge ${cls}">${status}</span></td></tr>`;
  }).join('')||'<tr><td colspan="4" class="muted">No products need reordering.</td></tr>';
}

/* ---------- PRODUCTS ---------- */
$('newProductBtn').onclick=()=>openProductModal();
$('closeProductBtn').onclick=$('cancelProductBtn').onclick=()=>hide($('productModal'));
$('productSearch').oninput=renderProducts;

function openProductModal(p=null){
  $('productModalTitle').textContent=p?'Edit product':'Add product';
  $('pName').value=p?.name||''; $('pSku').value=p?.sku||'';
  $('pCategory').value=p?.category||''; $('pUnit').value=p?.unit||'pcs';
  $('pCost').value=p?.cost_price??''; $('pPrice').value=p?.sell_price??'';
  $('pStock').value=p?.stock_qty??0; $('pReorder').value=p?.reorder_level??0;
  $('productMsg').textContent=''; show($('productModal'));
}

$('saveProductBtn').onclick=async()=>{
  const payload={
    name:$('pName').value.trim(), sku:$('pSku').value.trim()||null,
    category:$('pCategory').value.trim()||null, unit:$('pUnit').value.trim()||'pcs',
    cost_price:Number($('pCost').value||0), sell_price:Number($('pPrice').value||0),
    stock_qty:Number($('pStock').value||0), reorder_level:Number($('pReorder').value||0)
  };
  if(!payload.name){$('productMsg').textContent='Product name is required.';return;}

  const {error}=editingId
    ?await sb.from('products').update(payload).eq('id',editingId)
    :await sb.from('products').insert(payload);
  if(error){$('productMsg').textContent=error.message;return;}

  hide($('productModal')); toast('Product saved');
  await loadProducts(); renderProducts(); renderPos();
};

let editingId=null;
function editProduct(p){editingId=p.id;openProductModal(p);}
$('newProductBtn').addEventListener('click',()=>{editingId=null;});

async function deleteProduct(id){
  if(!confirm('Delete this product and its stock history?'))return;
  const {error}=await sb.from('products').delete().eq('id',id);
  if(error)return toast(error.message,true);
  toast('Product deleted'); await loadProducts(); renderProducts(); renderPos();
}

function renderProducts(){
  const q=$('productSearch').value.toLowerCase();
  const rows=products.filter(p=>!q||p.name.toLowerCase().includes(q)||(p.sku||'').toLowerCase().includes(q));
  $('productsTable').querySelector('tbody').innerHTML=rows.map(p=>{
    const stock=Number(p.stock_qty), reorder=Number(p.reorder_level);
    const badge=stock<=0?'<span class="badge out">Out</span>':stock<=reorder?'<span class="badge low">Low</span>':'<span class="badge ok">OK</span>';
    const margin=Number(p.sell_price)-Number(p.cost_price);
    return `<tr><td><strong>${esc(p.name)}</strong></td><td>${esc(p.sku||'-')}</td>
    <td>${esc(p.category||'-')}</td><td>${money(p.cost_price)}</td><td>${money(p.sell_price)}</td>
    <td>${stock} ${esc(p.unit||'')} ${badge}</td><td>${money(margin)}</td>
    <td><button class="btn ghost small" onclick='editProduct(${JSON.stringify(p).replaceAll("'", "&#39;")})'>Edit</button>
    <button class="btn danger-ghost small" onclick="deleteProduct('${p.id}')">Delete</button></td></tr>`;
  }).join('')||'<tr><td colspan="8" class="muted">No products found.</td></tr>';
}

/* ---------- STOCK ---------- */
$('newMovementBtn').onclick=async()=>{
  await loadProducts();
  $('mProduct').innerHTML=products.map(p=>`<option value="${p.id}">${esc(p.name)} — stock: ${p.stock_qty}</option>`).join('');
  $('mQty').value='';$('mNote').value='';$('movementMsg').textContent='';
  show($('movementModal'));
};
$('closeMovementBtn').onclick=$('cancelMovementBtn').onclick=()=>hide($('movementModal'));

$('saveMovementBtn').onclick=async()=>{
  const payload={product_id:$('mProduct').value,movement_type:$('mType').value,quantity:Number($('mQty').value),note:$('mNote').value.trim()||null};
  if(!payload.product_id||!(payload.quantity>0)){$('movementMsg').textContent='Select a product and enter a valid quantity.';return;}

  const {data:product}=await sb.from('products').select('stock_qty').eq('id',payload.product_id).single();
  if(payload.movement_type==='out'&&Number(product.stock_qty)<payload.quantity){
    $('movementMsg').textContent=`Not enough stock. Available: ${product.stock_qty}`;return;
  }

  const {error}=await sb.from('stock_movements').insert(payload);
  if(error){$('movementMsg').textContent=error.message;return;}

  const newQty=payload.movement_type==='in'?Number(product.stock_qty)+payload.quantity:Number(product.stock_qty)-payload.quantity;
  await sb.from('products').update({stock_qty:newQty}).eq('id',payload.product_id);

  hide($('movementModal')); toast('Stock movement saved');
  await loadProducts(); loadMovements(); renderProducts(); renderPos();
};

async function loadMovements(){
  const {data,error}=await sb.from('stock_movements')
    .select('*,products(name,unit)').order('created_at',{ascending:false}).limit(300);
  if(error)return toast(error.message,true);
  $('movementsTable').querySelector('tbody').innerHTML=(data||[]).map(m=>`
    <tr><td>${new Date(m.created_at).toLocaleString()}</td><td>${esc(m.products?.name||'-')}</td>
    <td><span class="badge ${m.movement_type==='in'?'in':'out-mv'}">${m.movement_type==='in'?'Stock In':'Stock Out'}</span></td>
    <td>${m.quantity}</td><td>${esc(m.note||'-')}</td></tr>`).join('')
    ||'<tr><td colspan="5" class="muted">No stock movements yet.</td></tr>';
}

/* ---------- POS ---------- */
$('posSearch').oninput=renderPos;
$('cartDiscount').oninput=renderCart;
$('clearCartBtn').onclick=()=>{cart=[];renderCart();};

function renderPos(){
  const q=$('posSearch').value.toLowerCase();
  const list=products.filter(p=>p.active!==false&&(!q||p.name.toLowerCase().includes(q)||(p.sku||'').toLowerCase().includes(q)));
  $('posProducts').innerHTML=list.map(p=>`
    <button class="product-tile" onclick="addToCart('${p.id}')">
      <strong>${esc(p.name)}</strong>
      <span class="price">${money(p.sell_price)}</span>
      <span class="stock">Stock: ${p.stock_qty} ${esc(p.unit||'')}</span>
    </button>`).join('')||'<p class="muted">No products found.</p>';
}

function addToCart(id){
  const p=products.find(x=>x.id===id); if(!p)return;
  const existing=cart.find(c=>c.product_id===id);
  const current=existing?existing.quantity:0;
  if(current+1>Number(p.stock_qty))return toast(`Only ${p.stock_qty} available`,true);
  if(existing)existing.quantity+=1;
  else cart.push({product_id:p.id,name:p.name,unit_price:Number(p.sell_price),quantity:1});
  renderCart();
}

function changeQty(id,delta){
  const item=cart.find(c=>c.product_id===id); if(!item)return;
  const p=products.find(x=>x.id===id);
  const next=item.quantity+delta;
  if(next<=0){cart=cart.filter(c=>c.product_id!==id);}
  else if(next>Number(p.stock_qty)){return toast(`Only ${p.stock_qty} available`,true);}
  else item.quantity=next;
  renderCart();
}

function removeFromCart(id){cart=cart.filter(c=>c.product_id!==id);renderCart();}

function renderCart(){
  $('cartTable').querySelector('tbody').innerHTML=cart.map(c=>`
    <tr><td>${esc(c.name)}</td>
    <td><button class="btn ghost small" onclick="changeQty('${c.product_id}',-1)">−</button> ${c.quantity}
    <button class="btn ghost small" onclick="changeQty('${c.product_id}',1)">+</button></td>
    <td>${money(c.unit_price)}</td><td>${money(c.quantity*c.unit_price)}</td>
    <td><button class="btn danger-ghost small" onclick="removeFromCart('${c.product_id}')">✕</button></td></tr>`).join('')
    ||'<tr><td colspan="5" class="muted">Cart is empty.</td></tr>';

  const subtotal=cart.reduce((s,c)=>s+c.quantity*c.unit_price,0);
  const discount=Number($('cartDiscount').value||0);
  $('cartTotal').textContent=money(Math.max(subtotal-discount,0));
}

$('checkoutBtn').onclick=async()=>{
  if(!cart.length)return toast('Cart is empty',true);
  const items=cart.map(c=>({product_id:c.product_id,quantity:c.quantity,unit_price:c.unit_price}));
  const {data,error}=await sb.rpc('create_sale',{
    p_items:items,p_customer:$('cartCustomer').value.trim()||null,
    p_payment_method:$('cartPayment').value,p_discount:Number($('cartDiscount').value||0)
  });
  if(error)return toast(error.message,true);

  const {data:sale,error:saleErr}=await sb.from('sales').select('*,sale_items(*)').eq('id',data).single();
  if(!saleErr){currentSale=sale;showReceipt(sale);}

  cart=[];$('cartCustomer').value='';$('cartDiscount').value=0;renderCart();
  toast('Sale completed');
  await loadProducts();renderPos();loadDashboard();
};

/* ---------- SALES LOG ---------- */
$('salesFilterBtn').onclick=loadSales;
$('salesSearch').oninput=loadSales;

async function loadSales(){
  let query=sb.from('sales').select('*,sale_items(quantity,product_name,unit_price,line_total)')
    .order('created_at',{ascending:false}).limit(300);

  if($('salesFrom').value)query=query.gte('created_at',$('salesFrom').value+'T00:00:00');
  if($('salesTo').value)query=query.lte('created_at',$('salesTo').value+'T23:59:59');

  const {data,error}=await query;
  if(error)return toast(error.message,true);

  const q=$('salesSearch').value.toLowerCase();
  const rows=(data||[]).filter(s=>!q||(s.customer||'').toLowerCase().includes(q));

  $('salesTable').querySelector('tbody').innerHTML=rows.map(s=>`
    <tr><td>${new Date(s.created_at).toLocaleString()}</td>
    <td><code>${s.id.slice(0,8)}</code></td><td>${esc(s.customer||'Walk-in')}</td>
    <td>${esc(s.payment_method)}</td>
    <td>${(s.sale_items||[]).reduce((a,i)=>a+Number(i.quantity),0)}</td>
    <td><strong>${money(s.total)}</strong></td><td class="profit">${money(s.profit)}</td>
    <td><button class="btn soft small" onclick="viewReceipt('${s.id}')">Receipt</button>
    <button class="btn danger-ghost small" onclick="deleteSale('${s.id}')">Delete</button></td></tr>`).join('')
    ||'<tr><td colspan="8" class="muted">No sales found.</td></tr>';
}

async function deleteSale(id){
  if(!confirm('Delete this sale? Stock will be restored automatically.'))return;
  const {error}=await sb.rpc('delete_sale',{p_sale_id:id});
  if(error)return toast(error.message,true);
  toast('Sale deleted and stock restored');
  await loadProducts();loadSales();loadDashboard();loadMovements();
}

/* ---------- RECEIPTS ---------- */
function receiptHTML(sale,forPrint=false){
  const items=sale.sale_items||[];
  const rows=items.map(i=>`
    <div class="line"><span>${esc(i.product_name)} x${i.quantity}</span><span>${money(i.line_total)}</span></div>`).join('');
  return `
    <h2>SmallBiz POS</h2>
    <div class="center muted">Sales Receipt</div>
    <hr/>
    <div class="line"><span>Receipt</span><span>${sale.id.slice(0,8).toUpperCase()}</span></div>
    <div class="line"><span>Date</span><span>${new Date(sale.created_at).toLocaleString()}</span></div>
    <div class="line"><span>Customer</span><span>${esc(sale.customer||'Walk-in')}</span></div>
    <div class="line"><span>Payment</span><span>${esc(sale.payment_method)}</span></div>
    <hr/>${rows}<hr/>
    <div class="line"><span>Subtotal</span><span>${money(sale.subtotal)}</span></div>
    <div class="line"><span>Discount</span><span>-${money(sale.discount)}</span></div>
    <div class="line total-line"><span>TOTAL</span><span>${money(sale.total)}</span></div>
    <hr/>
    <div class="center">Thank you for your business!</div>`;
}

function showReceipt(sale){
  $('receiptContent').innerHTML=receiptHTML(sale);
  show($('receiptModal'));
}

$('closeReceiptBtn').onclick=$('closeReceipt2Btn').onclick=()=>hide($('receiptModal'));

$('printReceiptBtn').onclick=()=>{
  if(!currentSale)return;
  $('printArea').innerHTML=`<div class="print-receipt">${receiptHTML(currentSale,true)}</div>`;
  window.print();
};

async function viewReceipt(id){
  const {data,error}=await sb.from('sales').select('*,sale_items(*)').eq('id',id).single();
  if(error)return toast(error.message,true);
  currentSale=data;showReceipt(data);
}

/* ---------- REPORTS ---------- */
$('generateReportBtn').onclick=generateReport;
$('printReportBtn').onclick=printReport;

async function generateReport(){
  const from=$('reportFrom').value?$('reportFrom').value+'T00:00:00':null;
  const to=$('reportTo').value?$('reportTo').value+'T23:59:59':null;

  let q=sb.from('sales').select('*,sale_items(product_name,quantity,line_total,line_profit)')
    .order('created_at',{ascending:true});
  if(from)q=q.gte('created_at',from);
  if(to)q=q.lte('created_at',to);

  const {data,error}=await q;
  if(error)return toast(error.message,true);

  const sales=data||[];
  const revenue=sales.reduce((a,s)=>a+Number(s.total),0);
  const profit=sales.reduce((a,s)=>a+Number(s.profit),0);
  const items=sales.reduce((a,s)=>a+(s.sale_items||[]).reduce((x,i)=>x+Number(i.quantity),0),0);

  $('repRevenue').textContent=money(revenue);
  $('repProfit').textContent=money(profit);
  $('repTransactions').textContent=sales.length;
  $('repItems').textContent=items;

  const byDay={};
  sales.forEach(s=>{
    const d=new Date(s.created_at).toISOString().slice(0,10);
    byDay[d]??={transactions:0,revenue:0,profit:0};
    byDay[d].transactions++;byDay[d].revenue+=Number(s.total);byDay[d].profit+=Number(s.profit);
  });

  $('dailyReportTable').querySelector('tbody').innerHTML=Object.entries(byDay).map(([d,v])=>`
    <tr><td>${d}</td><td>${v.transactions}</td><td>${money(v.revenue)}</td><td>${money(v.profit)}</td></tr>`).join('')
    ||'<tr><td colspan="4" class="muted">No sales in this period.</td></tr>';

  const byProduct={};
  sales.forEach(s=>(s.sale_items||[]).forEach(i=>{
    byProduct[i.product_name]??={qty:0,revenue:0,profit:0};
    byProduct[i.product_name].qty+=Number(i.quantity);
    byProduct[i.product_name].revenue+=Number(i.line_total);
    byProduct[i.product_name].profit+=Number(i.line_profit);
  }));

  const top=Object.entries(byProduct).sort((a,b)=>b[1].revenue-a[1].revenue).slice(0,15);
  $('topProductsTable').querySelector('tbody').innerHTML=top.map(([name,v])=>`
    <tr><td>${esc(name)}</td><td>${v.qty}</td><td>${money(v.revenue)}</td><td>${money(v.profit)}</td></tr>`).join('')
    ||'<tr><td colspan="4" class="muted">No product sales in this period.</td></tr>';

  reportData={from:$('reportFrom').value||'Beginning',to:$('reportTo').value||todayISO(),sales,revenue,profit,items,byDay,byProduct};
}

function printReport(){
  if(!reportData)return toast('Generate a report first',true);
  const daily=Object.entries(reportData.byDay).map(([d,v])=>`
    <tr><td>${d}</td><td>${v.transactions}</td><td>${money(v.revenue)}</td><td>${money(v.profit)}</td></tr>`).join('');
  const top=Object.entries(reportData.byProduct).sort((a,b)=>b[1].revenue-a[1].revenue).slice(0,15).map(([n,v])=>`
    <tr><td>${esc(n)}</td><td>${v.qty}</td><td>${money(v.revenue)}</td><td>${money(v.profit)}</td></tr>`).join('');

  $('printArea').innerHTML=`
    <div class="print-report">
      <h1>SmallBiz POS — Business Report</h1>
      <p><strong>Period:</strong> ${reportData.from} to ${reportData.to}</p>
      <p><strong>Revenue:</strong> ${money(reportData.revenue)} &nbsp; <strong>Profit:</strong> ${money(reportData.profit)} &nbsp;
      <strong>Transactions:</strong> ${reportData.sales.length} &nbsp; <strong>Items sold:</strong> ${reportData.items}</p>
      <h2>Daily Sales</h2>
      <table><thead><tr><th>Date</th><th>Transactions</th><th>Revenue</th><th>Profit</th></tr></thead><tbody>${daily}</tbody></table>
      <h2>Best-Selling Products</h2>
      <table><thead><tr><th>Product</th><th>Units</th><th>Revenue</th><th>Profit</th></tr></thead><tbody>${top}</tbody></table>
      <p>Generated on ${new Date().toLocaleString()}</p>
    </div>`;
  window.print();
}

/* init dates */
$('reportFrom').value=todayISO();
$('reportTo').value=todayISO();
$('salesFrom').value='';$('salesTo').value='';
