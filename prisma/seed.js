import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const categories = [
  { name: 'Burgers', slug: 'burgers', description: 'Smash burgers, stacked fresh and served hot.' },
  { name: 'Pizza', slug: 'pizza', description: 'Hand-stretched pies with house-made toppings.' },
  { name: 'Pasta', slug: 'pasta', description: 'Comforting pasta dishes finished to order.' },
  { name: 'Chicken', slug: 'chicken', description: 'Crispy, grilled, and roasted chicken favorites.' },
  { name: 'Drinks', slug: 'drinks', description: 'Refreshing drinks made for every meal.' },
  { name: 'Desserts', slug: 'desserts', description: 'Sweet finishes made for sharing.' },
];

const products = [
  {
    name: 'The Savora Stack',
    slug: 'the-savora-stack',
    category: 'Burgers',
    description: 'Two seared beef patties with sharp cheddar, crisp lettuce, house pickles, and Savora sauce on a toasted brioche bun.',
    image: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=900&q=82',
    price: 16.00,
    rating: 4.9,
    reviews: 304,
    popularity: 100,
    badge: 'Best seller',
    featured: true,
    stock: 40,
  },
  {
    name: 'Smoky BBQ Chicken Burger',
    slug: 'smoky-bbq-chicken-burger',
    category: 'Burgers',
    description: 'Grilled chicken, smoked barbecue glaze, crunchy slaw, and pepper jack cheese on a toasted bun.',
    image: 'https://images.unsplash.com/photo-1606755962773-d324e0a13086?auto=format&fit=crop&w=900&q=82',
    price: 14.50,
    rating: 4.7,
    reviews: 126,
    popularity: 86,
    featured: true,
    stock: 32,
  },
  {
    name: 'Garden Margherita',
    slug: 'garden-margherita',
    category: 'Pizza',
    description: 'San Marzano tomato, fresh mozzarella, basil, and a drizzle of extra-virgin olive oil.',
    image: 'https://images.unsplash.com/photo-1579751626657-72bc17010498?auto=format&fit=crop&w=900&q=82',
    price: 15.50,
    rating: 4.9,
    reviews: 218,
    popularity: 98,
    badge: 'Guest favorite',
    featured: true,
    stock: 25,
  },
  {
    name: 'Calabrian Heat',
    slug: 'calabrian-heat',
    category: 'Pizza',
    description: 'Pepperoni, roasted peppers, Calabrian chile, hot honey, and whipped ricotta.',
    image: 'https://images.unsplash.com/photo-1628840042765-356cda07504e?auto=format&fit=crop&w=900&q=82',
    price: 18.00,
    rating: 4.8,
    reviews: 174,
    popularity: 91,
    badge: 'A little spicy',
    featured: true,
    stock: 30,
  },
  {
    name: 'Sunday Pappardelle',
    slug: 'sunday-pappardelle',
    category: 'Pasta',
    description: 'Wide ribbons of pasta tossed with slow-braised beef ragu, parmesan, and fresh herbs.',
    image: 'https://images.unsplash.com/photo-1551183053-bf91a1d81141?auto=format&fit=crop&w=900&q=82',
    price: 19.00,
    rating: 4.9,
    reviews: 167,
    popularity: 94,
    badge: 'Slow cooked',
    featured: true,
    stock: 18,
  },
  {
    name: 'Creamy Tuscan Chicken Pasta',
    slug: 'creamy-tuscan-chicken-pasta',
    category: 'Pasta',
    description: 'Penne with grilled chicken, sun-dried tomatoes, baby spinach, and a parmesan cream sauce.',
    image: 'https://images.unsplash.com/photo-1473093295043-cdd812d0e601?auto=format&fit=crop&w=900&q=82',
    price: 17.50,
    rating: 4.8,
    reviews: 143,
    popularity: 89,
    featured: false,
    stock: 24,
  },
  {
    name: 'Crispy Buttermilk Chicken',
    slug: 'crispy-buttermilk-chicken',
    category: 'Chicken',
    description: 'Buttermilk-marinated chicken tenders with seasoned fries and a choice of house dipping sauce.',
    image: 'https://images.unsplash.com/photo-1562967914-608f82629710?auto=format&fit=crop&w=900&q=82',
    price: 15.00,
    rating: 4.8,
    reviews: 188,
    popularity: 92,
    badge: 'Crispy favorite',
    featured: true,
    stock: 35,
  },
  {
    name: 'Lemon Herb Roast Chicken',
    slug: 'lemon-herb-roast-chicken',
    category: 'Chicken',
    description: 'Juicy roasted chicken with lemon, garlic, garden herbs, and a side of seasonal vegetables.',
    image: 'https://images.unsplash.com/photo-1532550907401-a500c9a57435?auto=format&fit=crop&w=900&q=82',
    price: 18.50,
    rating: 4.7,
    reviews: 96,
    popularity: 78,
    featured: false,
    stock: 20,
  },
  {
    name: 'Fresh Mint Lemonade',
    slug: 'fresh-mint-lemonade',
    category: 'Drinks',
    description: 'Fresh-squeezed lemon, garden mint, and just enough sweetness, served over ice.',
    image: 'https://images.unsplash.com/photo-1544145945-f90425340c7e?auto=format&fit=crop&w=900&q=82',
    price: 5.00,
    rating: 4.8,
    reviews: 112,
    popularity: 80,
    featured: false,
    stock: 50,
  },
  {
    name: 'Strawberry Basil Cooler',
    slug: 'strawberry-basil-cooler',
    category: 'Drinks',
    description: 'Ripe strawberries, fresh basil, sparkling water, and a squeeze of lime.',
    image: 'https://images.unsplash.com/photo-1556679343-c7306c1976bc?auto=format&fit=crop&w=900&q=82',
    price: 6.00,
    rating: 4.7,
    reviews: 74,
    popularity: 70,
    featured: false,
    stock: 40,
  },
  {
    name: 'House Tiramisu',
    slug: 'house-tiramisu',
    category: 'Desserts',
    description: 'Espresso-soaked sponge layered with mascarpone cream and finished with cocoa.',
    image: 'https://images.unsplash.com/photo-1571877227200-a0d98ea607e9?auto=format&fit=crop&w=900&q=82',
    price: 8.50,
    rating: 4.9,
    reviews: 196,
    popularity: 93,
    badge: 'Made in-house',
    featured: false,
    stock: 30,
  },
  {
    name: 'Warm Chocolate Brownie',
    slug: 'warm-chocolate-brownie',
    category: 'Desserts',
    description: 'A rich, fudgy chocolate brownie served warm with vanilla bean ice cream.',
    image: 'https://images.unsplash.com/photo-1606313564200-e75d5e30476c?auto=format&fit=crop&w=900&q=82',
    price: 7.50,
    rating: 4.8,
    reviews: 138,
    popularity: 85,
    featured: false,
    stock: 28,
  },
];

async function main() {
  const result = await prisma.$transaction(async (tx) => {
    const productCount = await tx.product.count();
    if (productCount > 0) {
      return { skipped: true, productCount };
    }

    const categoryByName = new Map();
    for (const category of categories) {
      const existingCategory = await tx.category.findUnique({
        where: { name: category.name },
      });
      const savedCategory = existingCategory || await tx.category.create({ data: category });
      categoryByName.set(category.name, savedCategory);
    }

    const created = await tx.product.createMany({
      data: products.map(({ category, ...product }) => ({
        ...product,
        categoryId: categoryByName.get(category).id,
        isActive: true,
      })),
    });

    return { skipped: false, productCount: created.count };
  }, {
    isolationLevel: 'Serializable',
  });

  if (result.skipped) {
    console.log(`Seed skipped: ${result.productCount} products already exist; no records were changed.`);
    return;
  }

  console.log(`Seeded ${result.productCount} menu products across ${categories.length} categories.`);
}

main()
  .catch((error) => {
    console.error('Safe product seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
