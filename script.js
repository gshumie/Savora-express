(() => {
	"use strict";

	const CART_KEY = "savora-express-demo-cart-v1";
	const SESSION_KEY = "savora-express-session-v1";
	const TAX_RATE = 0.08;
	const DELIVERY_FEE = 3.99;
	const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
	const photo = (id, width = 900) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${width}&q=82`;
	const reliableDrinkImage = photo("photo-1544145945-f90425340c7e");
	const fallbackProducts = [
		{ id: "margherita", name: "Garden Margherita", category: "Pizza", price: 15.5, rating: 4.9, reviews: 218, popularity: 98, badge: "Guest favorite", description: "San Marzano tomato, fresh mozzarella, basil, and a drizzle of olive oil.", image: photo("photo-1579751626657-72bc17010498") },
		{ id: "spicy-salami", name: "Calabrian Heat", category: "Pizza", price: 18, rating: 4.8, reviews: 174, popularity: 91, badge: "A little spicy", description: "Pepperoni, roasted peppers, hot honey, and whipped ricotta.", image: photo("photo-1628840042765-356cda07504e") },
		{ id: "mushroom-pizza", name: "Wild Mushroom", category: "Pizza", price: 17.5, rating: 4.7, reviews: 93, popularity: 74, description: "Roasted mushrooms, thyme, fontina, and a garlic cream base.", image: photo("photo-1571407970349-bc81e7e96d47") },
		{ id: "savora-burger", name: "The Savora Stack", category: "Burgers", price: 16, rating: 4.9, reviews: 304, popularity: 100, badge: "Best seller", description: "Two smash patties, sharp cheddar, house pickles, and Savora sauce.", image: photo("photo-1568901346375-23c9450c58cd") },
		{ id: "crispy-chicken", name: "Crispy Chicken Sando", category: "Burgers", price: 15, rating: 4.8, reviews: 182, popularity: 89, description: "Buttermilk-fried chicken, crunchy slaw, and bright lemon mayo.", image: photo("photo-1606755962773-d324e0a13086") },
		{ id: "mushroom-burger", name: "Portobello Melt", category: "Burgers", price: 14.5, rating: 4.6, reviews: 77, popularity: 68, description: "Grilled portobello, smoked provolone, onion jam, and baby greens.", image: photo("photo-1553979459-d2229ba7433a") },
		{ id: "pappardelle", name: "Sunday Pappardelle", category: "Pasta", price: 19, rating: 4.9, reviews: 167, popularity: 94, badge: "Slow cooked", description: "Wide ribbons, slow-braised beef ragu, parmesan, and fresh herbs.", image: photo("photo-1551183053-bf91a1d81141") },
		{ id: "lemon-pasta", name: "Lemon Ricotta Rigatoni", category: "Pasta", price: 17, rating: 4.7, reviews: 116, popularity: 81, description: "Silky ricotta, lemon zest, baby spinach, and cracked pepper.", image: photo("photo-1473093295043-cdd812d0e601") },
		{ id: "pesto-pasta", name: "Basil Pesto Linguine", category: "Pasta", price: 16.5, rating: 4.6, reviews: 84, popularity: 73, description: "House basil pesto, toasted pine nuts, parmesan, and cherry tomato.", image: photo("photo-1473093295043-cdd812d0e601") },
		{ id: "roast-chicken", name: "Herb-Roasted Chicken", category: "Chicken", price: 20, rating: 4.8, reviews: 141, popularity: 86, badge: "Kitchen pick", description: "Lemon-herb chicken, crispy potatoes, and pan jus.", image: photo("photo-1532550907401-a500c9a57435") },
		{ id: "chicken-wings", name: "Sticky Citrus Wings", category: "Chicken", price: 14, rating: 4.7, reviews: 159, popularity: 88, description: "Slow-roasted wings glazed with orange, ginger, and a gentle chili.", image: photo("photo-1527477396000-e27163b481c2") },
		{ id: "chicken-bowl", name: "Green Market Chicken Bowl", category: "Chicken", price: 16, rating: 4.6, reviews: 71, popularity: 70, description: "Grilled chicken, grains, crisp vegetables, and herby yogurt.", image: photo("photo-1512621776951-a57141f2eefd") },
		{ id: "family-feast", name: "Savora Sharing Feast", category: "Traditional Food", price: 38, rating: 4.9, reviews: 126, popularity: 92, badge: "15% off today", description: "A generous table spread with roasted chicken, spiced rice, salad, and warm flatbread.", image: photo("photo-1547592180-85f173990554"), originalPrice: 44.7 },
		{ id: "shawarma-plate", name: "Market Shawarma Plate", category: "Traditional Food", price: 18.5, rating: 4.8, reviews: 102, popularity: 84, description: "Warm spices, grilled meat, fragrant rice, chopped salad, and tahini.", image: photo("photo-1547592180-85f173990554") },
		{ id: "lentil-stew", name: "Slow-Simmered Lentils", category: "Traditional Food", price: 14, rating: 4.7, reviews: 65, popularity: 65, description: "Comforting lentils, tomato, warming spices, and a spoon of yogurt.", image: photo("photo-1547592180-85f173990554") },
		{ id: "tiramisu", name: "House Tiramisu", category: "Desserts", price: 8.5, rating: 4.9, reviews: 196, popularity: 93, badge: "Made in-house", description: "Espresso-soaked layers, mascarpone cream, and cocoa.", image: photo("photo-1571877227200-a0d98ea607e9") },
		{ id: "chocolate-cake", name: "Warm Chocolate Cake", category: "Desserts", price: 9, rating: 4.8, reviews: 147, popularity: 87, description: "Rich dark chocolate cake, vanilla cream, and seasonal berries.", image: photo("photo-1578985545062-69928b1d9587") },
		{ id: "berry-cheesecake", name: "Market Berry Cheesecake", category: "Desserts", price: 8.5, rating: 4.7, reviews: 81, popularity: 72, description: "Creamy baked cheesecake with a bright mixed-berry compote.", image: photo("photo-1533134242443-d4fd215305ad") },
		{ id: "house-lemonade", name: "Fresh Mint Lemonade", category: "Drinks", price: 5, rating: 4.8, reviews: 112, popularity: 80, description: "Fresh-squeezed lemon, garden mint, and just enough sweetness.", image: reliableDrinkImage },
		{ id: "iced-tea", name: "Peach Garden Iced Tea", category: "Drinks", price: 4.5, rating: 4.6, reviews: 58, popularity: 62, description: "Black tea steeped strong and finished with ripe peach.", image: photo("photo-1499638309848-e9968540da83") },
		{ id: "sparkling-water", name: "Citrus Sparkling Water", category: "Drinks", price: 3.5, rating: 4.5, reviews: 42, popularity: 57, description: "Chilled sparkling water with a squeeze of fresh citrus.", image: reliableDrinkImage },
		{ id: "weeknight-pairing", name: "The Weeknight Pairing", category: "Traditional Food", price: 25, originalPrice: 31.5, rating: 4.8, reviews: 88, popularity: 78, badge: "Daily special", description: "Two market plates with a shared salad and fresh mint lemonade.", image: photo("photo-1547592180-85f173990554") },
		{ id: "seasonal-pasta", name: "Seasonal Garden Pasta", category: "Pasta", price: 15.5, originalPrice: 18, rating: 4.7, reviews: 54, popularity: 75, badge: "Seasonal", description: "Fresh pasta with market greens, sweet peas, lemon, and parmesan.", image: photo("photo-1473093295043-cdd812d0e601") }
	];

	let products = [...fallbackProducts];
	let backendAvailable = false;
	let cart = loadCart();

	function getSessionId() {
		let sessionId = localStorage.getItem(SESSION_KEY);
		if (!sessionId) {
			sessionId = window.crypto?.randomUUID?.() || `savora-${Date.now()}-${Math.random().toString(36).slice(2)}`;
			localStorage.setItem(SESSION_KEY, sessionId);
		}
		return sessionId;
	}

	async function hydrateProducts() {
		try {
			const response = await fetch("/api/products", { cache: "no-store" });
			if (!response.ok) throw new Error(`API returned ${response.status}`);
			const payload = await response.json();
			const apiProducts = Array.isArray(payload?.products) ? payload.products : Array.isArray(payload) ? payload : [];
			if (apiProducts.length) {
				backendAvailable = true;
				products = apiProducts.map((product) => ({
					id: product.id,
					slug: product.slug,
					name: product.name,
					category: product.category || "General",
					price: Number(product.price || 0),
					rating: Number(product.rating || 4.7),
					reviews: Number(product.reviews || 0),
					popularity: Number(product.popularity || 0),
					badge: product.badge || null,
					description: product.description || "",
					image: product.image || "https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=900&q=82",
					originalPrice: product.originalPrice ? Number(product.originalPrice) : undefined,
				}));
				return;
			}
		} catch (error) {
			console.warn("Backend menu API unavailable, using local static catalog.", error);
		}
		products = [...fallbackProducts];
	}

	function loadCart() {
		try {
			const saved = JSON.parse(localStorage.getItem(CART_KEY) || "{}");
			if (!saved || typeof saved !== "object" || Array.isArray(saved)) {
				console.warn("Cart data is missing or malformed. Resetting to an empty cart.");
				return {};
			}
			const normalized = Object.fromEntries(Object.entries(saved).filter(([id, quantity]) => products.some((item) => item.id === id) && Number.isInteger(quantity) && quantity > 0 && quantity <= 99));
			return normalized;
		} catch (error) {
			console.error("Unable to read the Savora cart from LocalStorage:", error);
			return {};
		}
	}

	function saveCart() {
		try {
			localStorage.setItem(CART_KEY, JSON.stringify(cart));
		} catch (error) {
			console.error("Cart could not be saved to LocalStorage:", error);
			showToast("Cart works for this visit, but browser storage is unavailable.", true);
		}
	}

	function money(value) {
		return currency.format(value);
	}

	function getItems() {
		return Object.entries(cart).map(([id, quantity]) => ({ product: products.find((item) => item.id === id), quantity })).filter((item) => item.product);
	}

	function subtotal() {
		return getItems().reduce((sum, item) => sum + item.product.price * item.quantity, 0);
	}

	function itemCount() {
		return Object.values(cart).reduce((sum, quantity) => sum + quantity, 0);
	}

	function updateCartIndicators() {
		const count = itemCount();
		document.querySelectorAll(".cart-count").forEach((badge) => { badge.textContent = String(count); });
		document.querySelectorAll(".cart-link").forEach((link) => { link.setAttribute("aria-label", `Shopping cart, ${count} ${count === 1 ? "item" : "items"}`); });
	}

	function showToast(message, isError = false) {
		const region = document.querySelector(".toast-region");
		if (!region) return;
		const toast = document.createElement("div");
		toast.className = `toast${isError ? " toast-error" : ""}`;
		toast.textContent = message;
		region.append(toast);
		window.setTimeout(() => toast.remove(), 3200);
	}

	function addToCart(id) {
		if (!products.some((product) => product.id === id)) {
			console.warn("Attempted to add an unknown product ID to the cart:", id);
			return;
		}
		cart[id] = Math.min(99, (cart[id] || 0) + 1);
		saveCart();
		updateCartIndicators();
		renderCheckout();
		const product = products.find((item) => item.id === id);
		showToast(`${product.name} added to your cart.`);
	}

	function changeQuantity(id, delta) {
		if (!cart[id]) return;
		const next = cart[id] + delta;
		if (next <= 0) delete cart[id];
		else cart[id] = Math.min(99, next);
		saveCart();
		updateCartIndicators();
		renderCheckout();
	}

	function removeFromCart(id) {
		if (!cart[id]) return;
		delete cart[id];
		saveCart();
		updateCartIndicators();
		renderCheckout();
		showToast("Item removed from your cart.");
	}

	function dishCard(product) {
		const rating = `${product.rating.toFixed(1)} <span>(${product.reviews} demo reviews)</span>`;
		return `<article class="dish-card"><div class="dish-image-wrap"><img src="${product.image}" alt="${product.name}" loading="lazy">${product.badge ? `<span class="dish-badge">${product.badge}</span>` : ""}</div><div class="dish-body"><div class="dish-title-row"><h3>${product.name}</h3><span class="dish-price">${money(product.price)}</span></div><p class="dish-description">${product.description}</p><div class="dish-meta"><span class="dish-rating" aria-label="Rated ${product.rating} out of 5, ${product.reviews} demo reviews">★ ${rating}</span><button class="button button-small" type="button" data-add="${product.id}" aria-label="Add ${product.name} to cart">Add <span aria-hidden="true">+</span></button></div></div></article>`;
	}

	function initMenu() {
		const grid = document.querySelector("#menu-grid");
		const tabs = document.querySelector("#category-tabs");
		const search = document.querySelector("#menu-search");
		const sort = document.querySelector("#menu-sort");
		if (!grid || !tabs || !search || !sort) return;

		let selectedCategory = new URLSearchParams(window.location.search).get("category") || "All";
		const categories = ["All", ...new Set(products.map((product) => product.category))];
		if (!categories.includes(selectedCategory)) selectedCategory = "All";
		tabs.innerHTML = categories.map((category) => `<button type="button" class="category-tab" data-category="${category}" aria-pressed="${category === selectedCategory}">${category}</button>`).join("");

		function render() {
			const query = search.value.trim().toLocaleLowerCase();
			let visible = products.filter((product) => (selectedCategory === "All" || product.category === selectedCategory) && `${product.name} ${product.description} ${product.category}`.toLocaleLowerCase().includes(query));
			if (sort.value === "price-asc") visible.sort((a, b) => a.price - b.price);
			if (sort.value === "price-desc") visible.sort((a, b) => b.price - a.price);
			if (sort.value === "popular") visible.sort((a, b) => b.popularity - a.popularity);
			const result = document.querySelector("#menu-result");
			result.textContent = `${visible.length} ${visible.length === 1 ? "dish" : "dishes"}${selectedCategory === "All" ? "" : ` in ${selectedCategory}`} · USD`;
			grid.innerHTML = visible.length ? visible.map(dishCard).join("") : `<div class="empty-state"><strong>No dishes found just yet.</strong>Try another search or choose a different category.</div>`;
		}

		tabs.addEventListener("click", (event) => {
			const button = event.target.closest("[data-category]");
			if (!button) return;
			selectedCategory = button.dataset.category;
			tabs.querySelectorAll("[data-category]").forEach((tab) => tab.setAttribute("aria-pressed", String(tab === button)));
			render();
		});
		search.addEventListener("input", render);
		sort.addEventListener("change", render);
		render();
	}

	function initFeaturedDishes() {
		const target = document.querySelector("#featured-dishes");
		if (!target) return;
		[
			{ id: "savora-burger", slug: "the-savora-stack" },
			{ id: "margherita", slug: "garden-margherita" },
			{ id: "pappardelle", slug: "sunday-pappardelle" },
		].forEach(({ id, slug }) => {
			const product = products.find((item) => item.id === id || item.slug === slug);
			if (product) target.insertAdjacentHTML("beforeend", dishCard(product));
		});
	}

	function initOffers() {
		const target = document.querySelector("#special-offers");
		if (!target) return;
		const offers = backendAvailable
			? [
				{ slug: "the-savora-stack", label: "Guest favorite", title: "The Savora Stack" },
				{ slug: "garden-margherita", label: "Pizza night", title: "Garden Margherita" },
				{ slug: "sunday-pappardelle", label: "House favorite", title: "Sunday Pappardelle" },
			]
			: [
				{ id: "family-feast", label: "Gathering favorite", title: "The Savora Sharing Feast" },
				{ id: "weeknight-pairing", label: "Today only", title: "The Weeknight Pairing" },
				{ id: "seasonal-pasta", label: "In season", title: "Seasonal Garden Pasta" },
			];
		target.innerHTML = offers.map(({ id, slug, label, title }) => {
			const product = products.find((item) => item.id === id || item.slug === slug);
			if (!product) return "";
			const originalPrice = product.originalPrice ? `<del>${money(product.originalPrice)}</del>` : "";
			return `<article class="offer-card"><img src="${product.image}" alt="${product.name}" loading="lazy"><div class="offer-card-body"><p class="eyebrow">${label}</p><h3>${title}</h3><p>${product.description}</p><div class="offer-price">${money(product.price)} ${originalPrice}</div><button class="button button-small" type="button" data-add="${product.id}">Add special to cart</button></div></article>`;
		}).join("");
	}

	function renderCheckout() {
		const itemsRegion = document.querySelector("#summary-items");
		if (!itemsRegion) return;
		const checkoutLayout = document.querySelector("#checkout-layout");
		const emptyState = document.querySelector("#checkout-empty");
		const items = getItems();
		const isEmpty = items.length === 0;
		checkoutLayout.hidden = isEmpty;
		emptyState.hidden = !isEmpty;
		if (isEmpty) return;

		itemsRegion.innerHTML = items.map(({ product, quantity }) => `<div class="summary-item"><div><strong>${product.name}</strong><small>${money(product.price)} each</small><div class="quantity-controls"><button class="icon-button" type="button" data-cart-action="decrease" data-id="${product.id}" aria-label="Decrease ${product.name} quantity">−</button><span aria-live="polite">${quantity}</span><button class="icon-button" type="button" data-cart-action="increase" data-id="${product.id}" aria-label="Increase ${product.name} quantity">+</button><button class="text-link" type="button" data-cart-action="remove" data-id="${product.id}" aria-label="Remove ${product.name}" style="border:0;background:none;cursor:pointer">Remove</button></div></div><strong>${money(product.price * quantity)}</strong></div>`).join("");
		const amount = subtotal();
		const pickup = document.querySelector("input[name='fulfillment'][value='pickup']")?.checked || false;
		const delivery = pickup ? 0 : DELIVERY_FEE;
		const tax = amount * TAX_RATE;
		document.querySelector("#summary-subtotal").textContent = money(amount);
		document.querySelector("#summary-tax").textContent = money(tax);
		document.querySelector("#summary-delivery").textContent = pickup ? "Free" : money(delivery);
		document.querySelector("#delivery-label").textContent = pickup ? "Pickup" : "Delivery";
		document.querySelector("#summary-total").textContent = money(amount + tax + delivery);
	}

	function validatePhone(value) {
		const normalized = value.trim();
		if (!normalized) return true;
		return /^[+]?[\d()+ .-]{6,24}$/.test(normalized);
	}

	function attachPhoneValidation(form) {
		form.querySelectorAll("input[type='tel']").forEach((input) => {
			const validate = () => {
				input.setCustomValidity(validatePhone(input.value) ? "" : "Please enter a valid phone number.");
			};
			input.addEventListener("input", validate);
			input.addEventListener("blur", validate);
			validate();
		});
	}

	function initCheckout() {
		const form = document.querySelector("#checkout-form");
		if (!form) return;
		const addressField = document.querySelector("#address-field");
		const address = document.querySelector("#checkout-address");
		const status = form.querySelector("[data-form-status]");
		const layout = document.querySelector("#checkout-layout");
		const confirmation = document.querySelector("#order-confirmation");
		const params = new URLSearchParams(window.location.search);
		const paymentStatus = params.get("status");
		const orderNumber = params.get("order");

		if (paymentStatus === "success" && orderNumber) {
			status.textContent = "Payment confirmed.";
			document.querySelector("#confirmation-eyebrow").textContent = "Payment confirmed";
			document.querySelector("#confirmation-message").textContent = "Your card payment cleared securely. We’re preparing your Savora order now.";
			document.querySelector("#confirmation-details").textContent = `Order ${orderNumber} · Card payment approved · We’ll keep you posted as it’s prepared.`;
			layout.hidden = true;
			confirmation.hidden = false;
			window.scrollTo({ top: confirmation.getBoundingClientRect().top + window.scrollY - 100, behavior: "smooth" });
		}

		if (paymentStatus === "cancelled") {
			status.textContent = "Payment was cancelled. You can retry your checkout at any time.";
		}

		attachPhoneValidation(form);
		form.addEventListener("change", (event) => {
			if (event.target.name === "fulfillment") {
				const pickup = event.target.value === "pickup";
				address.required = !pickup;
				addressField.hidden = pickup;
				renderCheckout();
			}
		});
		form.addEventListener("submit", async (event) => {
			event.preventDefault();
			if (!itemCount()) {
				showToast("Add a dish before confirming your demo order.", true);
				return;
			}
			if (!form.checkValidity()) {
				form.reportValidity();
				status.textContent = "Please check the highlighted details.";
				return;
			}
			const formData = new FormData(form);
			const name = String(formData.get("name") || "Guest").trim();
			const fulfillment = formData.get("fulfillment") === "pickup" ? "pickup" : "delivery";
			let confirmationDetail = `${name} · ${fulfillment === "pickup" ? "Pickup" : "Delivery"} · Demo total ${document.querySelector("#summary-total").textContent} · No real order was placed.`;
			if (backendAvailable) {
				const sessionId = getSessionId();
				const submitButton = document.querySelector("#place-demo-order");
				submitButton.disabled = true;
				status.textContent = "Submitting your order…";
				try {
					const cartResponse = await fetch("/api/cart/replace", {
						method: "POST",
						headers: { "Content-Type": "application/json", "X-Session-Id": sessionId },
						body: JSON.stringify({ sessionId, items: Object.entries(cart).map(([productId, quantity]) => ({ productId, quantity })) }),
					});
					const cartResult = await cartResponse.json();
					if (!cartResponse.ok) throw new Error(cartResult.error || "Unable to sync your cart.");

					const orderResponse = await fetch("/api/orders/checkout-session", {
						method: "POST",
						headers: { "Content-Type": "application/json", "X-Session-Id": sessionId },
						body: JSON.stringify({
							sessionId,
							customerName: name,
							customerEmail: String(formData.get("email") || "").trim(),
							customerPhone: String(formData.get("phone") || "").trim(),
							fulfillment,
							address: String(formData.get("address") || "").trim(),
							notes: String(formData.get("notes") || "").trim(),
						}),
					});
					const orderResult = await orderResponse.json();
					if (!orderResponse.ok) throw new Error(orderResult.error || "Unable to place your order.");

					if (orderResult.paymentUrl) {
						window.location.href = orderResult.paymentUrl;
						return;
					}

					confirmationDetail = `${name} · ${fulfillment === "pickup" ? "Pickup" : "Delivery"} · Order ${orderResult.order.orderNumber} · Total ${money(orderResult.order.total)} · Demo payment mode.`;
					document.querySelector("#confirmation-eyebrow").textContent = "Order received";
					document.querySelector("#confirmation-message").textContent = "Your order has been saved. Payment is currently running in demo mode.";
				} catch (error) {
					status.textContent = error.message || "Unable to submit your order. Please try again.";
					submitButton.disabled = false;
					return;
				}
			} else {
				status.textContent = "Demo confirmation only. The backend is currently unavailable.";
			}
			document.querySelector("#confirmation-details").textContent = confirmationDetail;
			layout.hidden = true;
			confirmation.hidden = false;
			cart = {};
			saveCart();
			updateCartIndicators();
			window.scrollTo({ top: confirmation.getBoundingClientRect().top + window.scrollY - 100, behavior: "smooth" });
		});
		renderCheckout();
	}

	function initForms() {
		document.querySelectorAll("[data-contact-form]").forEach((form) => {
			attachPhoneValidation(form);
			form.addEventListener("submit", (event) => {
				event.preventDefault();
				const status = form.querySelector("[data-form-status]");
				if (!form.checkValidity()) {
					form.reportValidity();
					status.textContent = "Please check the highlighted fields and try again.";
					return;
				}
				status.textContent = "Thanks. Your message is validated in this demo, but has not been sent.";
				form.reset();
			});
		});
		document.querySelectorAll("[data-newsletter-form]").forEach((form) => {
			form.addEventListener("submit", (event) => {
				event.preventDefault();
				if (!form.checkValidity()) {
					form.reportValidity();
					return;
				}
				showToast("Thanks for signing up. This demo does not save your email.");
				form.reset();
			});
		});
	}

	function initNavigation() {
		const toggle = document.querySelector(".menu-toggle");
		const nav = document.querySelector("#primary-nav");
		if (!toggle || !nav) return;
		toggle.addEventListener("click", () => {
			const open = toggle.getAttribute("aria-expanded") !== "true";
			toggle.setAttribute("aria-expanded", String(open));
			toggle.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
			nav.classList.toggle("is-open", open);
		});
		nav.addEventListener("click", (event) => {
			if (event.target.closest("a")) {
				nav.classList.remove("is-open");
				toggle.setAttribute("aria-expanded", "false");
				toggle.setAttribute("aria-label", "Open navigation");
			}
		});
	}

	document.addEventListener("click", (event) => {
		const addButton = event.target.closest("[data-add]");
		if (addButton) {
			addToCart(addButton.dataset.add);
			return;
		}
		const cartButton = event.target.closest("[data-cart-action]");
		if (!cartButton) return;
		const { cartAction: action, id } = cartButton.dataset;
		if (action === "increase") changeQuantity(id, 1);
		if (action === "decrease") changeQuantity(id, -1);
		if (action === "remove") removeFromCart(id);
	});

	window.addEventListener("storage", (event) => {
		if (event.key !== CART_KEY) return;
		try {
			cart = JSON.parse(event.newValue || "{}") || {};
		} catch (error) {
			console.error("Could not sync cart after storage event:", error);
			cart = {};
		}
		updateCartIndicators();
		renderCheckout();
	});

	async function boot() {
		document.querySelectorAll("[data-year]").forEach((element) => { element.textContent = String(new Date().getFullYear()); });
		await hydrateProducts();
		cart = loadCart();
		updateCartIndicators();
		initNavigation();
		initFeaturedDishes();
		initOffers();
		initMenu();
		initCheckout();
		initForms();
	}

	boot();
})();
