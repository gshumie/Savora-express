import { toMinorUnits } from '../lib/money.js';

function assertPaidSessionMatchesRecords({ session, orderId, payment, config }) {
  if (!Number.isSafeInteger(session.amount_total) || session.amount_total < 0) {
    throw new Error('Paid Stripe checkout event has an invalid amount.');
  }
  if (
    typeof session.currency !== 'string'
    || typeof config.stripeCurrency !== 'string'
    || session.currency.toUpperCase() !== config.stripeCurrency.toUpperCase()
  ) {
    throw new Error('Paid Stripe checkout event has an invalid currency.');
  }
  if (
    payment?.orderId !== orderId
    || payment?.order?.id !== orderId
    || payment.provider !== 'STRIPE'
    || payment.transactionId !== session.id
    || !['PENDING', 'PAID'].includes(payment.status)
    || !['PENDING', 'CONFIRMED'].includes(payment.order.status)
  ) {
    throw new Error('Paid Stripe checkout event did not match a valid pending payment.');
  }

  const paidAmount = session.amount_total;
  if (
    toMinorUnits(String(payment.amount)) !== paidAmount
    || toMinorUnits(String(payment.order.total)) !== paidAmount
  ) {
    throw new Error('Paid Stripe checkout amount does not match the order.');
  }
}

export function createStripeWebhookHandler({ stripe, prisma, config }) {
  return async (req, res) => {
    if (config.paymentProvider !== 'stripe') {
      return res.status(200).json({ received: true, mode: 'disabled' });
    }
    if (!stripe || !config.stripeWebhookSecret) {
      return res.status(503).json({ error: 'Stripe webhook verification is not configured.' });
    }

    try {
      const event = stripe.webhooks.constructEvent(
        req.body,
        req.headers['stripe-signature'],
        config.stripeWebhookSecret,
      );

      if (event.type === 'checkout.session.completed' && event.data.object.payment_status === 'paid') {
        const session = event.data.object;
        const orderId = session.metadata?.orderId;
        if (!orderId || !session.id) {
          throw new Error('Paid Stripe checkout event is missing its order reference.');
        }

        await prisma.$transaction(async (tx) => {
          const payment = await tx.payment.findUnique({
            where: { orderId },
            include: { order: true },
          });
          assertPaidSessionMatchesRecords({ session, orderId, payment, config });

          const updatedPayment = await tx.payment.updateMany({
            where: {
              orderId,
              provider: 'STRIPE',
              status: 'PENDING',
              transactionId: session.id,
            },
            data: { status: 'PAID' },
          });

          if (updatedPayment.count === 0) {
            const currentPayment = await tx.payment.findUnique({ where: { orderId } });
            const alreadyPaidForSession = (
              currentPayment?.provider === 'STRIPE'
              && currentPayment.status === 'PAID'
              && currentPayment.transactionId === session.id
            );
            if (!alreadyPaidForSession) {
              throw new Error('Paid Stripe checkout event did not update a matching pending payment.');
            }
          }

          const updatedOrder = await tx.order.updateMany({
            where: { id: orderId, status: 'PENDING' },
            data: { status: 'CONFIRMED' },
          });

          if (updatedOrder.count === 0) {
            const order = await tx.order.findUnique({ where: { id: orderId } });
            if (order?.status !== 'CONFIRMED') {
              throw new Error('Paid Stripe checkout event did not confirm its order.');
            }
          }
        });
      }

      return res.status(200).json({ received: true });
    } catch (error) {
      console.error('Stripe webhook processing failed.');
      return res.status(503).json({ error: 'Stripe webhook processing is temporarily unavailable.' });
    }
  };
}
