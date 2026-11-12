export async function initializePaymentProvider({ prisma, orderId, provider, initialize }) {
  try {
    return await initialize();
  } catch (error) {
    try {
      await prisma.$transaction(async (tx) => {
        const failedPayment = await tx.payment.updateMany({
          where: { orderId, provider, status: 'PENDING' },
          data: { status: 'FAILED' },
        });
        if (failedPayment.count === 0) {
          const payment = await tx.payment.findUnique({ where: { orderId } });
          if (payment?.status === 'PAID') return;
        }
        await tx.order.updateMany({
          where: { id: orderId, status: 'PENDING' },
          data: { status: 'CANCELLED' },
        });
      });
    } catch {
      console.error('Unable to confirm cleanup after payment provider initialization failed.');
      throw new Error('Payment provider initialization failed and order cleanup could not be confirmed.');
    }
    throw error;
  }
}
