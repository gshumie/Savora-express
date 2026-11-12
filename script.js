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

	async function boot() {
		document.querySelectorAll("[data-year]").forEach((element) => { element.textContent = String(new Date().getFullYear()); });
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
		initNavigation();
		initFeaturedDishes();
		initOffers();
		initMenu();
		initProductDetails();
		initCheckout();
		initForms();
	}

	boot();
})();
