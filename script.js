import {
	CURRENCY,
	calculateCartSubtotalMinorUnits,
	calculateCheckoutTotals,
	formatMinorUnits,
	toMinorUnits,
} from "./money.js";
import { APPROVED_ETB_PRICES } from "./approvedPrices.js";
import { normalizePersistedCart, serializePersistedCart } from "./cartPersistence.js";

(() => {
	"use strict";
	const CART_KEY = "savora-express-demo-cart-v1";
	const SESSION_KEY = "savora-express-session-v1";
	const photo = (id, width = 900) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${width}&q=82`;
	const reliableDrinkImage = photo("photo-1544145945-f90425340c7e");
	const fallbackProducts = [
		{ id: "garden-margherita", slug: "garden-margherita", name: "Garden Margherita", category: "Pizza", price: APPROVED_ETB_PRICES["garden-margherita"], rating: 4.9, reviews: 218, popularity: 98, badge: "Guest favorite", description: "San Marzano tomato, fresh mozzarella, basil, and a drizzle of olive oil.", image: photo("photo-1579751626657-72bc17010498") },
		{ id: "calabrian-heat", slug: "calabrian-heat", name: "Calabrian Heat", category: "Pizza", price: APPROVED_ETB_PRICES["calabrian-heat"], rating: 4.8, reviews: 174, popularity: 91, badge: "A little spicy", description: "Pepperoni, roasted peppers, hot honey, and whipped ricotta.", image: photo("photo-1628840042765-356cda07504e") },
		{ id: "the-savora-stack", slug: "the-savora-stack", name: "The Savora Stack", category: "Burgers", price: APPROVED_ETB_PRICES["the-savora-stack"], rating: 4.9, reviews: 304, popularity: 100, badge: "Best seller", description: "Two smash patties, sharp cheddar, house pickles, and Savora sauce.", image: photo("photo-1568901346375-23c9450c58cd") },
		{ id: "smoky-bbq-chicken-burger", slug: "smoky-bbq-chicken-burger", name: "Smoky BBQ Chicken Burger", category: "Burgers", price: APPROVED_ETB_PRICES["smoky-bbq-chicken-burger"], rating: 4.7, reviews: 126, popularity: 86, description: "Grilled chicken, smoked barbecue glaze, crunchy slaw, and pepper jack cheese.", image: photo("photo-1606755962773-d324e0a13086") },
		{ id: "sunday-pappardelle", slug: "sunday-pappardelle", name: "Sunday Pappardelle", category: "Pasta", price: APPROVED_ETB_PRICES["sunday-pappardelle"], rating: 4.9, reviews: 167, popularity: 94, badge: "Slow cooked", description: "Wide ribbons, slow-braised beef ragu, parmesan, and fresh herbs.", image: photo("photo-1551183053-bf91a1d81141") },
		{ id: "creamy-tuscan-chicken-pasta", slug: "creamy-tuscan-chicken-pasta", name: "Creamy Tuscan Chicken Pasta", category: "Pasta", price: APPROVED_ETB_PRICES["creamy-tuscan-chicken-pasta"], rating: 4.8, reviews: 143, popularity: 89, description: "Penne with grilled chicken, sun-dried tomatoes, baby spinach, and parmesan cream sauce.", image: photo("photo-1473093295043-cdd812d0e601") },
		{ id: "crispy-buttermilk-chicken", slug: "crispy-buttermilk-chicken", name: "Crispy Buttermilk Chicken", category: "Chicken", price: APPROVED_ETB_PRICES["crispy-buttermilk-chicken"], rating: 4.8, reviews: 188, popularity: 92, badge: "Crispy favorite", description: "Buttermilk-marinated chicken tenders with seasoned fries and house dipping sauce.", image: photo("photo-1562967914-608f82629710") },
		{ id: "lemon-herb-roast-chicken", slug: "lemon-herb-roast-chicken", name: "Lemon Herb Roast Chicken", category: "Chicken", price: APPROVED_ETB_PRICES["lemon-herb-roast-chicken"], rating: 4.7, reviews: 96, popularity: 78, description: "Juicy roasted chicken with lemon, garlic, garden herbs, and seasonal vegetables.", image: photo("photo-1532550907401-a500c9a57435") },
		{ id: "fresh-mint-lemonade", slug: "fresh-mint-lemonade", name: "Fresh Mint Lemonade", category: "Drinks", price: APPROVED_ETB_PRICES["fresh-mint-lemonade"], rating: 4.8, reviews: 112, popularity: 80, description: "Fresh-squeezed lemon, garden mint, and just enough sweetness.", image: reliableDrinkImage },
		{ id: "strawberry-basil-cooler", slug: "strawberry-basil-cooler", name: "Strawberry Basil Cooler", category: "Drinks", price: APPROVED_ETB_PRICES["strawberry-basil-cooler"], rating: 4.7, reviews: 74, popularity: 70, description: "Ripe strawberries, fresh basil, sparkling water, and lime.", image: photo("photo-1556679343-c7306c1976bc") },
		{ id: "house-tiramisu", slug: "house-tiramisu", name: "House Tiramisu", category: "Desserts", price: APPROVED_ETB_PRICES["house-tiramisu"], rating: 4.9, reviews: 196, popularity: 93, badge: "Made in-house", description: "Espresso-soaked layers, mascarpone cream, and cocoa.", image: photo("photo-1571877227200-a0d98ea607e9") },
		{ id: "warm-chocolate-brownie", slug: "warm-chocolate-brownie", name: "Warm Chocolate Brownie", category: "Desserts", price: APPROVED_ETB_PRICES["warm-chocolate-brownie"], rating: 4.8, reviews: 138, popularity: 85, description: "A rich, fudgy chocolate brownie served warm with vanilla bean ice cream.", image: photo("photo-1606313564200-e75d5e30476c") }
	];

	let products = [...fallbackProducts];
	let backendAvailable = false;
	let etbPricesApproved = false;
	let paymentMethodLabel = "Payment method unavailable";
	let removedCartItemsCount = 0;
	let cart = {};

	function getCookie(name) {
		const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
		return match ? decodeURIComponent(match[1]) : null;
	}

	function getSessionId() {
		let sessionId = localStorage.getItem(SESSION_KEY)
			|| localStorage.getItem("session_id")
			|| getCookie("savora_session_id")
			|| getCookie("session_id");
		if (!sessionId) {
			sessionId = window.crypto?.randomUUID?.() || `savora-${Date.now()}-${Math.random().toString(36).slice(2)}`;
			localStorage.setItem(SESSION_KEY, sessionId);
		}
		document.cookie = `savora_session_id=${sessionId}; path=/; max-age=2592000; SameSite=Lax`;
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

	async function hydrateCheckoutConfig() {
		try {
			const response = await fetch("/api/checkout-config", { cache: "no-store" });
			if (!response.ok) throw new Error(`Checkout configuration returned ${response.status}`);
			const payload = await response.json();
			const supportedProviders = ["chapa", "stripe", "demo", "unavailable"];
			const supportedEnvironments = ["test", "live"];
			if (
				payload?.currency !== CURRENCY
				|| typeof payload?.pricesApproved !== "boolean"
				|| !supportedProviders.includes(payload?.paymentProvider)
				|| (payload.paymentProvider === "unavailable"
					? payload.paymentEnvironment !== null
					: !supportedEnvironments.includes(payload.paymentEnvironment))
			) {
				throw new Error("Checkout configuration is invalid.");
			}
			etbPricesApproved = payload.pricesApproved;
			if (payload.paymentProvider === "unavailable") {
				paymentMethodLabel = "Payment method unavailable";
			} else if (payload.paymentProvider === "demo") {
				paymentMethodLabel = "Demo (Test Mode)";
			} else {
				const name = payload.paymentProvider === "chapa" ? "Chapa" : "Stripe";
				const mode = payload.paymentEnvironment === "test" ? "Test Mode" : "Live Mode";
				paymentMethodLabel = `${name} (${mode})`;
			}
		} catch (error) {
			console.error("Could not load price approval status; checkout remains disabled.", error);
			etbPricesApproved = false;
			paymentMethodLabel = "Payment method unavailable";
		}
		document.querySelectorAll("[data-payment-method]").forEach((element) => {
			element.textContent = paymentMethodLabel;
		});
	}

	function loadCart() {
		try {
			const saved = JSON.parse(localStorage.getItem(CART_KEY) || "{}");
			const normalized = normalizePersistedCart(saved, products);
			removedCartItemsCount += normalized.removedCount;
			return normalized.cart;
		} catch (error) {
			console.error("Unable to read the Savora cart from LocalStorage:", error);
			return {};
		}
	}

	function saveCart() {
		try {
			localStorage.setItem(CART_KEY, JSON.stringify(serializePersistedCart(cart, products)));
		} catch (error) {
			console.error("Cart could not be saved to LocalStorage:", error);
			showToast("Cart works for this visit, but browser storage is unavailable.", true);
		}
	}

	function money(value) {
		return formatMinorUnits(toMinorUnits(value));
	}

	function moneyMinorUnits(value) {
		return formatMinorUnits(value);
	}

	function getItems() {
		return Object.entries(cart).map(([id, quantity]) => ({ product: products.find((item) => item.id === id), quantity })).filter((item) => item.product);
	}

	function subtotalMinorUnits() {
		return calculateCartSubtotalMinorUnits(
			getItems().map(({ product, quantity }) => ({ unitPrice: product.price, quantity })),
		);
	}

	function updatePriceApprovalNotice() {
		const message = etbPricesApproved
			? "Prices are shown in Ethiopian Birr (ETB) and are approved for checkout."
			: "Prices are shown in Ethiopian Birr (ETB), but the existing numeric amounts still need owner approval. Checkout is disabled.";
		document.querySelectorAll("[data-pricing-approval]").forEach((element) => {
			element.textContent = message;
		});
		const submitButton = document.querySelector("#place-demo-order");
		if (submitButton) submitButton.disabled = !etbPricesApproved;
	}

	function getPaymentStatusToken(orderNumber) {
		const fragmentToken = new URLSearchParams(window.location.hash.slice(1)).get("payment-token");
		const storageKey = `savora-payment-status:${orderNumber}`;
		let token = fragmentToken;
		try {
			if (token) sessionStorage.setItem(storageKey, token);
			else token = sessionStorage.getItem(storageKey);
		} catch {
			console.warn("Secure payment-status access could not be kept for a page refresh.");
		}
		if (fragmentToken) {
			window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
		}
		return token;
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
		return `<article class="dish-card"><div class="dish-image-wrap"><img src="${product.image}" alt="${product.name}" loading="lazy">${product.badge ? `<span class="dish-badge">${product.badge}</span>` : ""}</div><div class="dish-body"><div class="dish-title-row"><h3>${product.name}</h3><span class="dish-price">${money(product.price)}</span></div><p class="dish-description">${product.description}</p><div class="dish-meta"><span class="dish-rating" aria-label="Rated ${product.rating} out of 5, ${product.reviews} demo reviews">★ ${rating}</span><div class="dish-actions"><a class="text-link" href="product.html?slug=${encodeURIComponent(product.slug)}" aria-label="View details for ${product.name}">Details</a><button class="button button-small" type="button" data-add="${product.id}" aria-label="Add ${product.name} to cart">Add <span aria-hidden="true">+</span></button></div></div></div></article>`;
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
			result.textContent = `${visible.length} ${visible.length === 1 ? "dish" : "dishes"}${selectedCategory === "All" ? "" : ` in ${selectedCategory}`} · Prices in ${CURRENCY}`;
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

	function initProductDetails() {
		const target = document.querySelector("#product-detail");
		if (!target) return;

		const slug = new URLSearchParams(window.location.search).get("slug");
		const product = products.find((item) => item.slug === slug);
		if (!product) {
			const emptyState = document.createElement("div");
			emptyState.className = "empty-state product-detail-empty";
			const heading = document.createElement("strong");
			heading.textContent = "We couldn't find that dish.";
			const message = document.createTextNode(" Browse the menu to find another favorite. ");
			const menuLink = document.createElement("a");
			menuLink.className = "button button-small";
			menuLink.href = "menu.html";
			menuLink.textContent = "Browse the menu";
			emptyState.append(heading, message, menuLink);
			target.replaceChildren(emptyState);
			return;
		}

		document.title = `${product.name} | Savora Express`;
		document.querySelector("#product-category").textContent = product.category;
		document.querySelector("#product-breadcrumb").textContent = product.name;
		document.querySelector('meta[name="description"]').content = `${product.name}: ${product.description} Price shown in ETB. Checkout requires price approval.`;

		const article = document.createElement("article");
		article.className = "product-detail";
		const imageWrap = document.createElement("div");
		imageWrap.className = "product-detail-image";
		const image = document.createElement("img");
		image.src = product.image;
		image.alt = product.name;
		image.fetchPriority = "high";
		imageWrap.append(image);

		const copy = document.createElement("div");
		copy.className = "product-detail-copy";
		const category = document.createElement("p");
		category.className = "eyebrow";
		category.textContent = product.category;
		const heading = document.createElement("h1");
		heading.textContent = product.name;
		const description = document.createElement("p");
		description.className = "product-detail-description";
		description.textContent = product.description;
		const price = document.createElement("strong");
		price.className = "product-detail-price";
		price.textContent = money(product.price);

		const actions = document.createElement("div");
		actions.className = "product-detail-actions";
		const addButton = document.createElement("button");
		addButton.className = "button";
		addButton.type = "button";
		addButton.dataset.add = product.id;
		addButton.setAttribute("aria-label", `Add ${product.name} to cart`);
		addButton.textContent = "Add to cart";
		const cartLink = document.createElement("a");
		cartLink.className = "button button-outline";
		cartLink.href = "checkout.html";
		cartLink.textContent = "View cart";
		actions.append(addButton, cartLink);

		const note = document.createElement("p");
		note.className = "product-detail-note";
		note.textContent = etbPricesApproved
			? "Prices are shown in ETB and are approved for checkout."
			: "Prices are shown in ETB. Checkout remains disabled until price approval is enabled.";
		copy.append(category, heading, description, price, actions, note);
		article.append(imageWrap, copy);
		target.replaceChildren(article);
	}

	function initFeaturedDishes() {
		const target = document.querySelector("#featured-dishes");
		if (!target) return;
		[
			{ id: "the-savora-stack", slug: "the-savora-stack" },
			{ id: "garden-margherita", slug: "garden-margherita" },
			{ id: "sunday-pappardelle", slug: "sunday-pappardelle" },
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
				{ id: "the-savora-stack", label: "Guest favorite", title: "The Savora Stack" },
				{ id: "garden-margherita", label: "Pizza night", title: "Garden Margherita" },
				{ id: "sunday-pappardelle", label: "House favorite", title: "Sunday Pappardelle" },
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

		itemsRegion.innerHTML = items.map(({ product, quantity }) => {
			const unitPriceMinorUnits = toMinorUnits(product.price);
			return `<div class="summary-item"><div><strong>${product.name}</strong><small>${moneyMinorUnits(unitPriceMinorUnits)} each</small><div class="quantity-controls"><button class="icon-button" type="button" data-cart-action="decrease" data-id="${product.id}" aria-label="Decrease ${product.name} quantity">−</button><span aria-live="polite">${quantity}</span><button class="icon-button" type="button" data-cart-action="increase" data-id="${product.id}" aria-label="Increase ${product.name} quantity">+</button><button class="text-link" type="button" data-cart-action="remove" data-id="${product.id}" aria-label="Remove ${product.name}" style="border:0;background:none;cursor:pointer">Remove</button></div></div><strong>${moneyMinorUnits(unitPriceMinorUnits * quantity)}</strong></div>`;
		}).join("");
		const isPickup = document.querySelector("input[name='fulfillment'][value='pickup']")?.checked || false;
		const totals = calculateCheckoutTotals(subtotalMinorUnits(), isPickup ? "pickup" : "delivery");
		document.querySelector("#summary-subtotal").textContent = moneyMinorUnits(totals.subtotalMinorUnits);
		document.querySelector("#summary-tax").textContent = moneyMinorUnits(totals.taxMinorUnits);
		document.querySelector("#summary-delivery").textContent = isPickup ? "Free" : moneyMinorUnits(totals.deliveryFeeMinorUnits);
		document.querySelector("#delivery-label").textContent = isPickup ? "Pickup" : "Delivery";
		document.querySelector("#summary-total").textContent = moneyMinorUnits(totals.totalMinorUnits);
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
		updatePriceApprovalNotice();
		const paymentNote = document.querySelector(".demo-note div");
		if (paymentNote) {
			paymentNote.innerHTML = `<strong>ETB pricing approval required</strong><span data-pricing-approval></span>`;
			updatePriceApprovalNotice();
		}
		const user = getAuthUser();
		if (user) {
			const nameInput = document.querySelector("#checkout-name");
			const emailInput = document.querySelector("#checkout-email");
			if (nameInput && !nameInput.value && user.name) {
				nameInput.value = user.name;
			}
			if (emailInput && !emailInput.value && user.email) {
				emailInput.value = user.email;
			}
		}
		const addressField = document.querySelector("#address-field");
		const address = document.querySelector("#checkout-address");
		const status = form.querySelector("[data-form-status]");
		const layout = document.querySelector("#checkout-layout");
		const confirmation = document.querySelector("#order-confirmation");
		const params = new URLSearchParams(window.location.search);
		const paymentStatus = params.get("status");
		const orderNumber = params.get("order");
		const paymentStatusToken = orderNumber ? getPaymentStatusToken(orderNumber) : null;

		if (paymentStatus === "success" && orderNumber && paymentStatusToken) {
			status.textContent = "Checking payment status…";
			document.querySelector("#confirmation-eyebrow").textContent = "Payment verification";
			document.querySelector("#confirmation-message").textContent = "We’re checking your payment with the payment provider. This page does not confirm payment by itself.";
			document.querySelector("#confirmation-details").textContent = `Order ${orderNumber} · Payment status is being checked.`;
			layout.hidden = true;
			confirmation.hidden = false;
			fetch("/api/orders/payment-status", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ orderNumber, token: paymentStatusToken }),
			})
				.then(async (response) => {
					const result = await response.json();
					if (!response.ok) throw new Error(result.error || "Unable to check payment status.");
					return result;
				})
				.then((result) => {
					if (result.paymentStatus === "PAID" && result.orderStatus === "CONFIRMED") {
						try {
							sessionStorage.removeItem(`savora-payment-status:${orderNumber}`);
						} catch {
							console.warn("Verified payment-status access could not be cleared from this tab.");
						}
						status.textContent = "Payment verified.";
						document.querySelector("#confirmation-eyebrow").textContent = "Payment confirmed";
						document.querySelector("#confirmation-message").textContent = "Your payment has been verified by the server. We’re preparing your Savora order now.";
						document.querySelector("#confirmation-details").textContent = `Order ${orderNumber} · Payment approved · We’ll keep you posted as it’s prepared.`;
					} else {
						status.textContent = "Payment is still pending.";
						document.querySelector("#confirmation-eyebrow").textContent = "Payment pending";
						document.querySelector("#confirmation-message").textContent = "Payment and order status are checked by the server. Refresh this page to check again; the order remains unconfirmed until its persisted status is confirmed.";
						document.querySelector("#confirmation-details").textContent = `Order ${orderNumber} · Payment status: ${result.paymentStatus || "PENDING"} · Order status: ${result.orderStatus || "PENDING"}.`;
					}
				})
				.catch(() => {
					status.textContent = "Unable to check payment status.";
					document.querySelector("#confirmation-message").textContent = "We could not verify the payment right now. Your order remains pending until the server confirms payment.";
				});
			window.scrollTo({ top: confirmation.getBoundingClientRect().top + window.scrollY - 100, behavior: "smooth" });
		} else if (paymentStatus === "success" && orderNumber) {
			status.textContent = "Payment status access is unavailable.";
			document.querySelector("#confirmation-eyebrow").textContent = "Payment status unavailable";
			document.querySelector("#confirmation-message").textContent = "This secure payment-status link is missing or expired. Contact Savora Express for help.";
			document.querySelector("#confirmation-details").textContent = `Order ${orderNumber} · Status was not disclosed.`;
			layout.hidden = true;
			confirmation.hidden = false;
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
					const headers = getAuthHeaders({ "Content-Type": "application/json" });
					const cartResponse = await fetch("/api/cart/replace", {
						method: "POST",
						headers,
						body: JSON.stringify({ sessionId, items: Object.entries(cart).map(([productId, quantity]) => ({ productId, quantity })) }),
					});
					const cartResult = await cartResponse.json();
					if (!cartResponse.ok) throw new Error(cartResult.error || "Unable to sync your cart.");

					const orderResponse = await fetch("/api/orders/checkout-session", {
						method: "POST",
						headers,
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
			const normalized = normalizePersistedCart(JSON.parse(event.newValue || "{}"), products);
			cart = normalized.cart;
			if (normalized.removedCount > 0) {
				showToast("Some saved cart items are no longer available and were removed.", true);
			}
		} catch (error) {
			console.error("Could not sync cart after storage event:", error);
			cart = {};
		}
		updateCartIndicators();
		renderCheckout();
	});

	const AUTH_TOKEN_KEY = "savora-auth-token";
	const AUTH_USER_KEY = "savora-user";

	function getAuthToken() {
		return localStorage.getItem(AUTH_TOKEN_KEY)
			|| localStorage.getItem("token")
			|| localStorage.getItem("savora_token")
			|| getCookie("savora_token")
			|| null;
	}

	function getAuthUser() {
		try {
			const raw = localStorage.getItem(AUTH_USER_KEY)
				|| localStorage.getItem("user")
				|| localStorage.getItem("savora_user");
			return raw ? JSON.parse(raw) : null;
		} catch {
			return null;
		}
	}

	function setAuth(token, user) {
		localStorage.setItem(AUTH_TOKEN_KEY, token);
		localStorage.setItem("token", token);
		localStorage.setItem("savora_token", token);
		localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
		localStorage.setItem("user", JSON.stringify(user));
		document.cookie = `savora_token=${token}; path=/; max-age=604800; SameSite=Lax`;
		updateAccountLinks();
	}

	function clearAuth() {
		localStorage.removeItem(AUTH_TOKEN_KEY);
		localStorage.removeItem("token");
		localStorage.removeItem("savora_token");
		localStorage.removeItem(AUTH_USER_KEY);
		localStorage.removeItem("user");
		localStorage.removeItem("savora_user");
		document.cookie = "savora_token=; path=/; max-age=0; SameSite=Lax";
		updateAccountLinks();
	}

	function getAuthHeaders(extraHeaders = {}) {
		const headers = { ...extraHeaders };
		const token = getAuthToken();
		if (token) {
			headers["Authorization"] = `Bearer ${token}`;
		}
		const sessionId = getSessionId();
		if (sessionId) {
			headers["X-Session-Id"] = sessionId;
		}
		return headers;
	}

	function updateAccountLinks() {
		const user = getAuthUser();
		const isCheckout = document.body.dataset.page === "checkout";
		const loginUrl = isCheckout ? "login.html?redirect=checkout" : "login.html";
		document.querySelectorAll(".account-link").forEach((link) => {
			if (user) {
				if (user.role === "ADMIN") {
					link.href = "admin.html";
					link.title = `Admin: ${user.name}`;
					link.setAttribute("aria-label", "Admin Console");
				} else {
					link.href = loginUrl;
					link.title = `Signed in as ${user.name}`;
					link.setAttribute("aria-label", "Account Profile");
				}
			} else {
				link.href = loginUrl;
				link.title = "Sign in or create an account";
				link.setAttribute("aria-label", "Sign in or create an account");
			}
		});
	}

	function initAuth() {
		if (document.body.dataset.page !== "login") return;

		const profileView = document.querySelector("#auth-profile-view");
		const formsContainer = document.querySelector("#auth-forms-container");
		const tabLogin = document.querySelector("#tab-btn-login");
		const tabRegister = document.querySelector("#tab-btn-register");
		const loginForm = document.querySelector("#login-form");
		const registerForm = document.querySelector("#register-form");
		const statusMsg = document.querySelector("#auth-status-message");
		const linkSwitchRegister = document.querySelector("#link-switch-to-register");
		const linkSwitchLogin = document.querySelector("#link-switch-to-login");
		const btnLogout = document.querySelector("#btn-logout");
		const btnAdminPortal = document.querySelector("#btn-admin-portal");

		const params = new URLSearchParams(window.location.search);
		const redirect = params.get("redirect");

		function setTab(tab) {
			if (statusMsg) statusMsg.textContent = "";
			if (tab === "register") {
				tabRegister.classList.add("active");
				tabRegister.setAttribute("aria-selected", "true");
				tabLogin.classList.remove("active");
				tabLogin.setAttribute("aria-selected", "false");
				registerForm.hidden = false;
				loginForm.hidden = true;
			} else {
				tabLogin.classList.add("active");
				tabLogin.setAttribute("aria-selected", "true");
				tabRegister.classList.remove("active");
				tabRegister.setAttribute("aria-selected", "false");
				loginForm.hidden = false;
				registerForm.hidden = true;
			}
		}

		if (tabLogin && tabRegister) {
			tabLogin.addEventListener("click", () => setTab("login"));
			tabRegister.addEventListener("click", () => setTab("register"));
		}
		if (linkSwitchRegister) {
			linkSwitchRegister.addEventListener("click", (e) => { e.preventDefault(); setTab("register"); });
		}
		if (linkSwitchLogin) {
			linkSwitchLogin.addEventListener("click", (e) => { e.preventDefault(); setTab("login"); });
		}
		if (window.location.hash === "#register" || params.get("tab") === "register") {
			setTab("register");
		}

		async function checkActiveProfile() {
			const token = getAuthToken();
			if (!token) return;
			try {
				const response = await fetch("/api/auth/profile", {
					headers: { Authorization: `Bearer ${token}` },
				});
				if (response.ok) {
					const data = await response.json();
					if (data.user) {
						formsContainer.hidden = true;
						profileView.hidden = false;
						document.querySelector("#profile-welcome-heading").textContent = `Welcome, ${data.user.name}!`;
						document.querySelector("#profile-email-text").textContent = data.user.email;
						document.querySelector("#profile-role-badge").textContent = data.user.role === "ADMIN" ? "Administrator" : "Customer";
						if (data.user.role === "ADMIN" && btnAdminPortal) {
							btnAdminPortal.hidden = false;
						}
					}
				} else {
					clearAuth();
				}
			} catch {}
		}

		checkActiveProfile();

		if (loginForm) {
			loginForm.addEventListener("submit", async (e) => {
				e.preventDefault();
				const email = document.querySelector("#login-email").value.trim();
				const password = document.querySelector("#login-password").value;
				if (!email || !password) {
					statusMsg.textContent = "Please provide your email and password.";
					return;
				}
				const btn = document.querySelector("#btn-submit-login");
				btn.disabled = true;
				statusMsg.textContent = "Signing in…";
				try {
					const res = await fetch("/api/auth/login", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ email, password, sessionId: getSessionId() }),
					});
					const data = await res.json();
					if (!res.ok) throw new Error(data.error || "Login failed.");
					setAuth(data.token, data.user);
					showToast(`Welcome back, ${data.user.name}!`);
					if (data.user.role === "ADMIN") {
						window.location.href = "admin.html";
					} else if (redirect === "checkout") {
						window.location.href = "checkout.html";
					} else {
						window.location.href = "menu.html";
					}
				} catch (err) {
					statusMsg.textContent = err.message;
					btn.disabled = false;
				}
			});
		}

		if (registerForm) {
			registerForm.addEventListener("submit", async (e) => {
				e.preventDefault();
				const name = document.querySelector("#register-name").value.trim();
				const email = document.querySelector("#register-email").value.trim();
				const password = document.querySelector("#register-password").value;
				if (!name || !email || !password) {
					statusMsg.textContent = "Please fill in all fields.";
					return;
				}
				if (password.length < 6) {
					statusMsg.textContent = "Password must be at least 6 characters.";
					return;
				}
				const btn = document.querySelector("#btn-submit-register");
				btn.disabled = true;
				statusMsg.textContent = "Creating your account…";
				try {
					const res = await fetch("/api/auth/register", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ name, email, password }),
					});
					const data = await res.json();
					if (!res.ok) throw new Error(data.error || "Registration failed.");
					setAuth(data.token, data.user);
					showToast(`Welcome to Savora Express, ${data.user.name}!`);
					if (data.user.role === "ADMIN") {
						window.location.href = "admin.html";
					} else if (redirect === "checkout") {
						window.location.href = "checkout.html";
					} else {
						window.location.href = "menu.html";
					}
				} catch (err) {
					statusMsg.textContent = err.message;
					btn.disabled = false;
				}
			});
		}

		if (btnLogout) {
			btnLogout.addEventListener("click", async () => {
				const token = getAuthToken();
				if (token) {
					try {
						await fetch("/api/auth/logout", {
							method: "POST",
							headers: { Authorization: `Bearer ${token}` },
						});
					} catch {}
				}
				clearAuth();
				showToast("Signed out successfully.");
				formsContainer.hidden = false;
				profileView.hidden = true;
				setTab("login");
			});
		}
	}

	function initAdmin() {
		if (document.body.dataset.page !== "admin") return;

		const guard = document.querySelector("#admin-auth-guard");
		const content = document.querySelector("#admin-dashboard-content");
		const welcomeMsg = document.querySelector("#admin-user-welcome");
		const btnRefresh = document.querySelector("#btn-refresh-dashboard");
		const btnLogout = document.querySelector("#admin-logout-btn");
		const tabOrders = document.querySelector("#tab-btn-orders");
		const tabMenu = document.querySelector("#tab-btn-menu");
		const panelOrders = document.querySelector("#panel-orders");
		const panelMenu = document.querySelector("#panel-menu");
		const btnToggleAddDish = document.querySelector("#btn-toggle-add-dish");
		const btnCancelAddDish = document.querySelector("#btn-cancel-add-dish");
		const addDishPanel = document.querySelector("#add-dish-panel");
		const addDishForm = document.querySelector("#add-dish-form");

		const token = getAuthToken();

		async function verifyAdmin() {
			if (!token) {
				guard.hidden = false;
				content.hidden = true;
				return false;
			}
			try {
				const res = await fetch("/api/auth/profile", {
					headers: { Authorization: `Bearer ${token}` },
				});
				if (!res.ok) throw new Error("Auth failed");
				const data = await res.json();
				if (data.user?.role !== "ADMIN") {
					guard.hidden = false;
					content.hidden = true;
					return false;
				}
				welcomeMsg.textContent = `Signed in as ${data.user.name} (${data.user.email})`;
				guard.hidden = true;
				content.hidden = false;
				return true;
			} catch {
				guard.hidden = false;
				content.hidden = true;
				return false;
			}
		}

		if (tabOrders && tabMenu) {
			tabOrders.addEventListener("click", () => {
				tabOrders.classList.add("active");
				tabOrders.setAttribute("aria-selected", "true");
				tabMenu.classList.remove("active");
				tabMenu.setAttribute("aria-selected", "false");
				panelOrders.hidden = false;
				panelMenu.hidden = true;
			});
			tabMenu.addEventListener("click", () => {
				tabMenu.classList.add("active");
				tabMenu.setAttribute("aria-selected", "true");
				tabOrders.classList.remove("active");
				tabOrders.setAttribute("aria-selected", "false");
				panelMenu.hidden = false;
				panelOrders.hidden = true;
			});
		}

		if (btnToggleAddDish) {
			btnToggleAddDish.addEventListener("click", () => {
				addDishPanel.hidden = !addDishPanel.hidden;
			});
		}
		if (btnCancelAddDish) {
			btnCancelAddDish.addEventListener("click", () => {
				addDishPanel.hidden = true;
				addDishForm.reset();
			});
		}

		async function loadLiveConfig() {
			try {
				const res = await fetch("/api/checkout-config", { cache: "no-store" });
				const data = await res.json();
				const providerEl = document.querySelector("#admin-payment-provider");
				const envEl = document.querySelector("#admin-payment-env");
				const approvalEl = document.querySelector("#admin-price-approval");
				if (providerEl) {
					providerEl.textContent = (data.paymentProvider || "demo").toUpperCase();
					providerEl.className = `status-pill ${data.paymentProvider === "chapa" ? "success" : "warning"}`;
				}
				if (envEl) envEl.textContent = (data.paymentEnvironment || "test").toUpperCase();
				if (approvalEl) {
					approvalEl.textContent = data.pricesApproved ? "APPROVED" : "PENDING APPROVAL";
					approvalEl.className = `status-pill ${data.pricesApproved ? "success" : "danger"}`;
				}
			} catch (err) {
				console.error("Admin live config error:", err);
			}
		}

		async function loadSummary() {
			try {
				const res = await fetch("/api/admin/summary", {
					headers: { Authorization: `Bearer ${token}` },
				});
				if (!res.ok) return;
				const { summary } = await res.json();
				document.querySelector("#stat-total-orders").textContent = String(summary.totalOrders || 0);
				document.querySelector("#stat-total-revenue").textContent = money(summary.totalRevenue || 0);
				document.querySelector("#stat-total-customers").textContent = String(summary.customers || 0);
				document.querySelector("#stat-total-products").textContent = String(summary.products || 0);
			} catch (err) {
				console.error("Admin summary error:", err);
			}
		}

		async function loadOrders() {
			const tbody = document.querySelector("#orders-table-body");
			try {
				const res = await fetch("/api/admin/orders", {
					headers: { Authorization: `Bearer ${token}` },
				});
				if (!res.ok) throw new Error("Could not load orders");
				const { orders } = await res.json();
				if (!orders || orders.length === 0) {
					tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:24px;color:var(--muted);">No customer orders placed yet.</td></tr>`;
					return;
				}
				tbody.innerHTML = orders.map((o) => {
					const date = new Date(o.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
					const itemsSummary = o.items?.map((i) => `${i.quantity}x ${i.product?.name || "Item"}`).join(", ") || "—";
					const paymentStatus = o.payment?.status || "PENDING";
					const paymentPillClass = paymentStatus === "PAID" ? "success" : paymentStatus === "FAILED" ? "danger" : "warning";
					return `
						<tr data-order-id="${o.id}">
							<td><strong>${o.orderNumber}</strong></td>
							<td style="white-space:nowrap;font-size:11px;">${date}</td>
							<td>
								<strong>${o.customerName}</strong><br>
								<small style="color:var(--muted)">${o.customerEmail}</small>
								${o.customerPhone ? `<br><small style="color:var(--muted)">${o.customerPhone}</small>` : ""}
							</td>
							<td style="max-width:200px;font-size:11px;" title="${itemsSummary}">${itemsSummary}</td>
							<td><strong>${money(o.total)}</strong></td>
							<td><span class="status-pill ${paymentPillClass}">${paymentStatus}</span></td>
							<td style="text-transform:capitalize;">${o.fulfillmentType || "Delivery"}</td>
							<td>
								<select class="table-status-select" data-order-status-select="${o.id}">
									${["PENDING", "CONFIRMED", "PREPARING", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED"].map(
										(s) => `<option value="${s}" ${o.status === s ? "selected" : ""}>${s}</option>`
									).join("")}
								</select>
							</td>
							<td>
								<button type="button" class="table-action-btn" data-action="update-order-status" data-order-id="${o.id}">Update</button>
							</td>
						</tr>
					`;
				}).join("");
			} catch (err) {
				tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:24px;color:var(--tomato);">${err.message}</td></tr>`;
			}
		}

		async function loadDishes() {
			const tbody = document.querySelector("#dishes-table-body");
			try {
				const res = await fetch("/api/products", { cache: "no-store" });
				if (!res.ok) throw new Error("Could not load products");
				const data = await res.json();
				const catalog = Array.isArray(data?.products) ? data.products : [];
				if (catalog.length === 0) {
					tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--muted);">No menu items found. Run database seed to populate.</td></tr>`;
					return;
				}
				tbody.innerHTML = catalog.map((p) => {
					const isActive = p.isActive !== false;
					return `
						<tr data-product-id="${p.id}">
							<td>
								<div style="display:flex;align-items:center;gap:10px;">
									<img src="${p.image}" alt="" style="width:38px;height:38px;border-radius:4px;object-fit:cover;">
									<div>
										<strong>${p.name}</strong>
										${p.badge ? `<br><small class="dish-badge" style="position:static;font-size:9px;display:inline-block;margin-top:2px;">${p.badge}</small>` : ""}
									</div>
								</div>
							</td>
							<td>${p.category || "General"}</td>
							<td><strong>${money(p.price)}</strong></td>
							<td>${p.stock ?? 50}</td>
							<td>
								<span class="status-pill ${isActive ? "success" : "danger"}">${isActive ? "ACTIVE" : "INACTIVE"}</span>
							</td>
							<td>
								<button type="button" class="table-action-btn" data-action="toggle-product" data-product-id="${p.id}" data-active="${isActive}">
									${isActive ? "Deactivate" : "Activate"}
								</button>
							</td>
						</tr>
					`;
				}).join("");
			} catch (err) {
				tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--tomato);">${err.message}</td></tr>`;
			}
		}

		async function loadCategories() {
			const select = document.querySelector("#dish-category");
			if (!select) return;
			try {
				const res = await fetch("/api/products/categories");
				const { categories } = await res.json();
				if (categories && categories.length) {
					select.innerHTML = '<option value="">Select a category</option>' + categories.map((c) => `<option value="${c.id}">${c.name}</option>`).join("");
				}
			} catch {}
		}

		document.addEventListener("click", async (e) => {
			const btn = e.target.closest('[data-action="update-order-status"]');
			if (!btn) return;
			const orderId = btn.dataset.orderId;
			const select = document.querySelector(`[data-order-status-select="${orderId}"]`);
			if (!select) return;
			const newStatus = select.value;
			btn.disabled = true;
			try {
				const res = await fetch(`/api/admin/orders/${orderId}/status`, {
					method: "PATCH",
					headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
					body: JSON.stringify({ status: newStatus }),
				});
				if (!res.ok) throw new Error("Could not update order status.");
				showToast(`Order status updated to ${newStatus}.`);
			} catch (err) {
				showToast(err.message, true);
			} finally {
				btn.disabled = false;
			}
		});

		document.addEventListener("click", async (e) => {
			const btn = e.target.closest('[data-action="toggle-product"]');
			if (!btn) return;
			const productId = btn.dataset.productId;
			const currentActive = btn.dataset.active === "true";
			btn.disabled = true;
			try {
				const res = await fetch(`/api/products/${productId}`, {
					method: "PATCH",
					headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
					body: JSON.stringify({ isActive: !currentActive }),
				});
				if (!res.ok) throw new Error("Could not update dish.");
				showToast(`Dish is now ${!currentActive ? "Active" : "Inactive"}.`);
				loadDishes();
			} catch (err) {
				showToast(err.message, true);
			} finally {
				btn.disabled = false;
			}
		});

		if (addDishForm) {
			addDishForm.addEventListener("submit", async (e) => {
				e.preventDefault();
				const formData = new FormData(addDishForm);
				const payload = {
					name: formData.get("name"),
					categoryId: formData.get("categoryId"),
					price: Number(formData.get("price")),
					stock: Number(formData.get("stock") || 50),
					description: formData.get("description"),
					image: formData.get("image") || undefined,
				};
				const submitBtn = addDishForm.querySelector('button[type="submit"]');
				submitBtn.disabled = true;
				try {
					const res = await fetch("/api/products", {
						method: "POST",
						headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
						body: JSON.stringify(payload),
					});
					const data = await res.json();
					if (!res.ok) throw new Error(data.error || "Could not add dish.");
					showToast(`Added "${payload.name}" to menu.`);
					addDishForm.reset();
					addDishPanel.hidden = true;
					loadDishes();
					loadSummary();
				} catch (err) {
					showToast(err.message, true);
				} finally {
					submitBtn.disabled = false;
				}
			});
		}

		if (btnRefresh) {
			btnRefresh.addEventListener("click", () => {
				loadLiveConfig();
				loadSummary();
				loadOrders();
				loadDishes();
				showToast("Dashboard refreshed.");
			});
		}

		if (btnLogout) {
			btnLogout.addEventListener("click", () => {
				clearAuth();
				window.location.href = "login.html";
			});
		}

		verifyAdmin().then((ok) => {
			if (ok) {
				loadLiveConfig();
				loadSummary();
				loadOrders();
				loadDishes();
				loadCategories();
			}
		});
	}

	async function boot() {
		document.querySelectorAll("[data-year]").forEach((element) => { element.textContent = String(new Date().getFullYear()); });
		getSessionId();
		await hydrateProducts();
		await hydrateCheckoutConfig();
		cart = loadCart();
		saveCart();
		if (removedCartItemsCount > 0) {
			showToast("Some older cart items are no longer on the menu and were removed. Your available items were kept.", true);
			removedCartItemsCount = 0;
		}
		updateCartIndicators();
		updatePriceApprovalNotice();
		updateAccountLinks();
		initNavigation();
		initFeaturedDishes();
		initOffers();
		initMenu();
		initProductDetails();
		initCheckout();
		initForms();
		initAuth();
		initAdmin();
	}

	boot();
})();
