// SEEDED EXAMPLE. Planted bugs, each marked "SEEDED BUG":
//   1. Removing an item after a coupon is applied keeps the stale discount.
//   2. Clicking "Show changelog" twice throws an uncaught TypeError.
//   3. With ?flaky=1 the total is sometimes rendered wrong (non-deterministic).
const PRODUCTS = [
  { id: 'apple', name: 'Apple', price: 10 },
  { id: 'banana', name: 'Banana', price: 20 },
  { id: 'cherry', name: 'Cherry', price: 30 },
];
const flaky = new URLSearchParams(location.search).has('flaky');

const state = { cart: new Map(), coupon: null, discount: 0, changelog: null };

const $ = (sel) => document.querySelector(sel);
const money = (n) => `$${n.toFixed(2)}`;

function subtotal() {
  let s = 0;
  for (const [id, qty] of state.cart) s += PRODUCTS.find((p) => p.id === id).price * qty;
  return s;
}

function renderProducts() {
  const q = $('#search').value.trim().toLowerCase();
  const list = PRODUCTS.filter((p) => p.name.toLowerCase().includes(q));
  list.sort((a, b) => ($('#sort').value === 'price' ? a.price - b.price : a.name.localeCompare(b.name)));
  $('#products').innerHTML = '';
  for (const p of list) {
    const row = document.createElement('div');
    row.className = 'product';
    row.innerHTML = `<span>${p.name} ${money(p.price)}</span>`;
    const btn = document.createElement('button');
    btn.textContent = `Add ${p.name}`;
    btn.onclick = () => { state.cart.set(p.id, (state.cart.get(p.id) || 0) + 1); recompute(); };
    row.append(btn);
    $('#products').append(row);
  }
}

function recompute() {
  state.discount = state.coupon ? subtotal() * 0.1 : 0;
  renderCart();
}

function renderCart() {
  $('#cart').innerHTML = '';
  for (const [id, qty] of state.cart) {
    const p = PRODUCTS.find((x) => x.id === id);
    const li = document.createElement('li');
    li.textContent = `${p.name} x${qty} `;
    const rm = document.createElement('button');
    rm.textContent = `Remove ${p.name}`;
    rm.onclick = () => {
      state.cart.delete(id);
      // SEEDED BUG 1: should call recompute(); the discount stays computed from the old subtotal.
      renderCart();
    };
    li.append(rm);
    $('#cart').append(li);
  }
  $('#subtotal').textContent = money(subtotal());
  let total = subtotal() - state.discount;
  // SEEDED BUG 3: only active with ?flaky=1.
  if (flaky && Math.random() < 0.5) total += 1;
  $('#total').textContent = money(total);
}

$('#apply-coupon').onclick = () => {
  state.coupon = $('#coupon').value.trim().toUpperCase() === 'SAVE10' ? 'SAVE10' : null;
  recompute();
};
$('#search').oninput = renderProducts;
$('#sort').onchange = renderProducts;
$('#dark').onchange = (e) => {
  document.body.classList.toggle('dark', e.target.checked);
  localStorage.setItem('dark', e.target.checked ? '1' : '0');
};
if (localStorage.getItem('dark') === '1') { $('#dark').checked = true; document.body.classList.add('dark'); }

$('#changelog-btn').onclick = () => {
  if (state.changelog === null) {
    state.changelog = ['0.1.0 initial'];
    $('#changelog').textContent = state.changelog.join(', ');
    state.changelog = undefined; // SEEDED BUG 2: second click dereferences undefined.
    return;
  }
  $('#changelog').textContent = state.changelog.join(', ');
};

function route() {
  const about = location.hash === '#/about';
  $('#shop-view').hidden = about;
  $('#about-view').hidden = !about;
}
window.addEventListener('hashchange', route);
route();
renderProducts();
renderCart();
