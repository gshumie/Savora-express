import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatOrderNotification,
  buildTelegramMessage,
  buildEmailHtml,
  sendTelegramNotification,
  sendEmailNotification,
  notifyNewOrder,
} from '../src/services/notifications.js';

const mockOrder = {
  id: 'cuid-12345',
  orderNumber: 'SAV-20261116-TEST01',
  status: 'PENDING',
  fulfillmentType: 'DELIVERY',
  subtotal: 1300.00,
  tax: 104.00,
  deliveryFee: 150.00,
  total: 1554.00,
  customerName: 'Abebe Bikila',
  customerEmail: 'abebe@example.com',
  customerPhone: '0911223344',
  shippingAddress: 'Bole Medhanialem, House 45, Addis Ababa',
  notes: 'Please ring bell twice',
  payment: {
    status: 'PENDING',
    provider: 'CHAPA',
    transactionId: 'SAV-20261116-TEST01',
    amount: 1554.00,
  },
  items: [
    {
      quantity: 2,
      unitPrice: 650.00,
      product: { name: 'The Savora Stack' },
    },
  ],
};

test('formatOrderNotification: formats ORDER_CREATED with correct fields', () => {
  const formatted = formatOrderNotification(mockOrder, 'ORDER_CREATED');

  assert.equal(formatted.title, 'New Order Placed');
  assert.equal(formatted.orderNumber, 'SAV-20261116-TEST01');
  assert.equal(formatted.totalAmount, '1554.00');
  assert.equal(formatted.paymentStatus, 'PENDING');
  assert.equal(formatted.customerName, 'Abebe Bikila');
  assert.equal(formatted.customerPhone, '0911223344');
  assert.equal(formatted.shippingAddress, 'Bole Medhanialem, House 45, Addis Ababa');
  assert.equal(formatted.items.length, 1);
  assert.equal(formatted.items[0].name, 'The Savora Stack');
  assert.equal(formatted.items[0].quantity, 2);
  assert.equal(formatted.items[0].unitPrice, '650.00');
  assert.equal(formatted.items[0].lineTotal, '1300.00');
});

test('formatOrderNotification: formats PAYMENT_CONFIRMED with PAID status', () => {
  const formatted = formatOrderNotification(mockOrder, 'PAYMENT_CONFIRMED');

  assert.equal(formatted.title, 'Payment Confirmed (PAID)');
  assert.equal(formatted.paymentStatus, 'PAID');
});

test('formatOrderNotification: handles empty/missing fields gracefully', () => {
  const minimalOrder = { id: 'test-id' };
  const formatted = formatOrderNotification(minimalOrder);

  assert.equal(formatted.orderNumber, 'test-id');
  assert.equal(formatted.totalAmount, '0.00');
  assert.equal(formatted.customerName, 'Guest Customer');
  assert.equal(formatted.customerPhone, 'N/A');
  assert.equal(formatted.shippingAddress, 'N/A');
  assert.equal(formatted.items.length, 0);
});

test('buildTelegramMessage: generates valid HTML message escaping special characters', () => {
  const formatted = formatOrderNotification({
    ...mockOrder,
    customerName: 'Sam & Dean <Brothers>',
    notes: 'Bring spicy & extra sauce <hot>',
  }, 'ORDER_CREATED');

  const text = buildTelegramMessage(formatted);
  assert.match(text, /SAVORA EXPRESS/);
  assert.match(text, /SAV-20261116-TEST01/);
  assert.match(text, /Sam &amp; Dean &lt;Brothers&gt;/);
  assert.match(text, /Bring spicy &amp; extra sauce &lt;hot&gt;/);
  assert.match(text, /The Savora Stack/);
  assert.doesNotMatch(text, /<Brothers>/);
});

test('buildEmailHtml: generates structured HTML email with item rows and pricing totals', () => {
  const formatted = formatOrderNotification(mockOrder, 'ORDER_CREATED');
  const html = buildEmailHtml(formatted);

  assert.match(html, /SAVORA EXPRESS/);
  assert.match(html, /Order #SAV-20261116-TEST01/);
  assert.match(html, /Abebe Bikila/);
  assert.match(html, /0911223344/);
  assert.match(html, /The Savora Stack/);
  assert.match(html, /ETB 1554\.00/);
});

test('sendTelegramNotification: skips safely when credentials are missing', async () => {
  const result = await sendTelegramNotification({
    order: mockOrder,
    botToken: '',
    chatId: '',
  });

  assert.equal(result.sent, false);
  assert.match(result.reason, /not configured/);
});

test('sendTelegramNotification: sends message via Telegram bot API when configured', async () => {
  let requestedUrl = '';
  let requestedBody = null;

  const mockFetch = async (url, options) => {
    requestedUrl = url;
    requestedBody = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, result: { message_id: 99881 } }),
    };
  };

  const result = await sendTelegramNotification({
    order: mockOrder,
    eventType: 'ORDER_CREATED',
    botToken: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
    chatId: '-1001234567890',
    fetchImpl: mockFetch,
  });

  assert.equal(result.sent, true);
  assert.equal(result.provider, 'telegram');
  assert.equal(result.messageId, 99881);
  assert.equal(requestedUrl, 'https://api.telegram.org/bot123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11/sendMessage');
  assert.equal(requestedBody.chat_id, '-1001234567890');
  assert.equal(requestedBody.parse_mode, 'HTML');
  assert.match(requestedBody.text, /SAV-20261116-TEST01/);
});

test('sendTelegramNotification: handles API failure safely', async () => {
  const mockFetch = async () => ({
    ok: false,
    status: 400,
    json: async () => ({ ok: false, description: 'Chat not found' }),
  });

  await assert.rejects(
    async () => {
      await sendTelegramNotification({
        order: mockOrder,
        botToken: '123:token',
        chatId: 'bad-chat-id',
        fetchImpl: mockFetch,
      });
    },
    /Telegram API returned HTTP 400/
  );
});

test('sendEmailNotification: skips safely when ADMIN_NOTIFY_EMAIL is missing', async () => {
  const result = await sendEmailNotification({
    order: mockOrder,
    toEmail: '',
  });

  assert.equal(result.sent, false);
  assert.match(result.reason, /ADMIN_NOTIFY_EMAIL is not configured/);
});

test('sendEmailNotification: delivers via custom transport override', async () => {
  let sentMailOptions = null;
  const mockTransport = {
    sendMail: async (options) => {
      sentMailOptions = options;
      return { messageId: 'mock-mail-id-123' };
    },
  };

  const result = await sendEmailNotification({
    order: mockOrder,
    eventType: 'ORDER_CREATED',
    toEmail: 'admin@savoraexpress.com',
    transportOverride: mockTransport,
  });

  assert.equal(result.sent, true);
  assert.equal(result.provider, 'custom-transport');
  assert.equal(result.messageId, 'mock-mail-id-123');
  assert.equal(sentMailOptions.to, 'admin@savoraexpress.com');
  assert.match(sentMailOptions.subject, /SAV-20261116-TEST01/);
});

test('sendEmailNotification: delivers via Resend API when configured', async () => {
  let requestedUrl = '';
  let requestedHeaders = null;
  let requestedBody = null;

  const mockFetch = async (url, options) => {
    requestedUrl = url;
    requestedHeaders = options.headers;
    requestedBody = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: 'resend-email-msg-99' }),
    };
  };

  const result = await sendEmailNotification({
    order: mockOrder,
    eventType: 'ORDER_CREATED',
    toEmail: 'admin@savoraexpress.com',
    resendApiKey: 're_123456789',
    fetchImpl: mockFetch,
  });

  assert.equal(result.sent, true);
  assert.equal(result.provider, 'resend');
  assert.equal(result.id, 'resend-email-msg-99');
  assert.equal(requestedUrl, 'https://api.resend.com/emails');
  assert.equal(requestedHeaders.Authorization, 'Bearer re_123456789');
  assert.deepEqual(requestedBody.to, ['admin@savoraexpress.com']);
  assert.match(requestedBody.subject, /SAV-20261116-TEST01/);
});

test('notifyNewOrder: dispatches in parallel, never throws, and returns summary', async () => {
  const result = await notifyNewOrder(mockOrder, 'ORDER_CREATED');

  assert.equal(result.orderNumber, 'SAV-20261116-TEST01');
  assert.equal(result.eventType, 'ORDER_CREATED');
  assert.ok('telegram' in result);
  assert.ok('email' in result);
});

test('notifyNewOrder: handles missing order safely without throwing', async () => {
  const result = await notifyNewOrder(null);
  assert.equal(result.sent, false);
  assert.equal(result.reason, 'No order provided');
});
