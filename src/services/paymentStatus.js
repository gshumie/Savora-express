import { isValidOrderStatusToken } from '../lib/orderStatusToken.js';
import { verifyAndApplyChapaPayment } from './chapa.js';

export function createPaymentStatusHandler({ prisma, config }) {
  return async (req, res) => {
    const { orderNumber, token } = req.body || {};
    if (!isValidOrderStatusToken(token, orderNumber, config.paymentStatusTokenSecret)) {
      return res.status(401).json({ error: 'Payment status access is unauthorized.' });
    }

    try {
      const order = await prisma.order.findUnique({
        where: { orderNumber },
        include: { payment: true },
      });
      if (!order?.payment) {
        return res.status(404).json({ error: 'Order not found.' });
      }

      let paymentStatus = order.payment.status;
      let orderStatus = order.status;
      if (order.payment.provider === 'CHAPA' && paymentStatus === 'PENDING' && order.payment.transactionId) {
        const result = await verifyAndApplyChapaPayment({
          prisma,
          txRef: order.payment.transactionId,
          secretKey: config.chapaSecretKey,
          currency: config.chapaCurrency,
        });
        paymentStatus = result.paymentStatus;
        orderStatus = result.orderStatus || orderStatus;
      }

      return res.json({ orderStatus, paymentStatus });
    } catch (error) {
      console.error('Payment status verification failed.');
      return res.status(502).json({ error: 'Unable to verify payment status right now.' });
    }
  };
}
