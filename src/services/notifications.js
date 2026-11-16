import nodemailer from 'nodemailer';
import { config } from '../config.js';

function escapeTelegramHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatOrderNotification(order, eventType = 'NEW_ORDER') {
  const isPaid = eventType === 'PAYMENT_CONFIRMED' || order?.payment?.status === 'PAID';
  const eventTitle = isPaid
    ? 'Payment Confirmed (PAID)'
    : eventType === 'ORDER_CREATED'
      ? 'New Order Placed'
      : 'Order Notification';

  const orderNumber = order?.orderNumber || order?.id || 'N/A';
  const totalAmount = Number(order?.total || 0).toFixed(2);
  const subtotalAmount = Number(order?.subtotal || order?.total || 0).toFixed(2);
  const taxAmount = Number(order?.tax || 0).toFixed(2);
  const deliveryFee = Number(order?.deliveryFee || 0).toFixed(2);
  const paymentStatus = isPaid ? 'PAID' : (order?.payment?.status || 'PENDING');
  const fulfillmentType = order?.fulfillmentType || 'DELIVERY';
  const customerName = order?.customerName || 'Guest Customer';
  const customerEmail = order?.customerEmail || 'N/A';
  const customerPhone = order?.customerPhone || 'N/A';
  const shippingAddress = order?.shippingAddress || (fulfillmentType === 'PICKUP' ? 'Store Pickup' : 'N/A');
  const notes = order?.notes || 'None';

  const rawItems = Array.isArray(order?.items) ? order.items : [];
  const items = rawItems.map((item) => {
    const name = item.product?.name || item.name || 'Dish Item';
    const quantity = Number(item.quantity || 1);
    const unitPrice = Number(item.unitPrice || item.price || 0).toFixed(2);
    const lineTotal = (quantity * Number(unitPrice)).toFixed(2);
    return {
      name,
      quantity,
      unitPrice,
      lineTotal,
      text: `${quantity}x ${name} @ ETB ${unitPrice} = ETB ${lineTotal}`,
    };
  });

  return {
    title: eventTitle,
    orderNumber,
    totalAmount,
    subtotalAmount,
    taxAmount,
    deliveryFee,
    paymentStatus,
    fulfillmentType,
    customerName,
    customerEmail,
    customerPhone,
    shippingAddress,
    notes,
    items,
  };
}

export function buildTelegramMessage(formatted) {
  const e = escapeTelegramHtml;
  const itemsList = formatted.items.length > 0
    ? formatted.items.map((i) => `  • <b>${e(i.quantity)}x</b> ${e(i.name)} (ETB ${e(i.unitPrice)}) = <b>ETB ${e(i.lineTotal)}</b>`).join('\n')
    : '  • <i>No item details recorded</i>';

  const statusEmoji = formatted.paymentStatus === 'PAID' ? '✅' : '⏳';

  return [
    `🚨 <b>SAVORA EXPRESS: ${e(formatted.title.toUpperCase())}</b>`,
    ``,
    `<b>Order #:</b> <code>${e(formatted.orderNumber)}</code>`,
    `<b>Total:</b> <b>ETB ${e(formatted.totalAmount)}</b>`,
    `<b>Payment:</b> ${statusEmoji} <b>${e(formatted.paymentStatus)}</b>`,
    `<b>Fulfillment:</b> ${e(formatted.fulfillmentType)}`,
    ``,
    `<b>👤 Customer Information:</b>`,
    `• <b>Name:</b> ${e(formatted.customerName)}`,
    `• <b>Phone:</b> ${e(formatted.customerPhone)}`,
    `• <b>Email:</b> ${e(formatted.customerEmail)}`,
    `• <b>Address:</b> ${e(formatted.shippingAddress)}`,
    `• <b>Notes:</b> ${e(formatted.notes)}`,
    ``,
    `<b>📦 Ordered Dishes:</b>`,
    itemsList,
  ].join('\n');
}

export function buildEmailHtml(formatted) {
  const e = escapeHtml;
  const itemsRows = formatted.items.length > 0
    ? formatted.items.map((i) => `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;">${e(i.name)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:center;">${e(i.quantity)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:right;">ETB ${e(i.unitPrice)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:600;">ETB ${e(i.lineTotal)}</td>
      </tr>
    `).join('')
    : `<tr><td colspan="4" style="padding:12px;text-align:center;color:#6b7280;">No item details available</td></tr>`;

  const statusBg = formatted.paymentStatus === 'PAID' ? '#10b981' : '#f59e0b';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${e(formatted.title)} - ${e(formatted.orderNumber)}</title>
</head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;margin:0;padding:24px;background:#f9fafb;color:#1f2937;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);border:1px solid #e5e7eb;">
    <tr>
      <td style="background:#1a1a1a;padding:24px 32px;color:#ffffff;">
        <h1 style="margin:0;font-size:22px;color:#f97316;letter-spacing:0.5px;">SAVORA EXPRESS</h1>
        <p style="margin:6px 0 0;font-size:14px;color:#d1d5db;">Order Notification System</p>
      </td>
    </tr>
    <tr>
      <td style="padding:32px;">
        <div style="display:inline-block;padding:6px 14px;border-radius:999px;background:${statusBg};color:#ffffff;font-size:12px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:18px;">
          ${e(formatted.title)} • ${e(formatted.paymentStatus)}
        </div>

        <h2 style="margin:0 0 16px;font-size:20px;color:#111827;">Order #${e(formatted.orderNumber)}</h2>

        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;font-size:14px;background:#f9fafb;padding:16px;border-radius:6px;border:1px solid #f3f4f6;">
          <tr>
            <td style="padding:4px 0;width:35%;color:#6b7280;">Customer:</td>
            <td style="padding:4px 0;font-weight:600;color:#111827;">${e(formatted.customerName)}</td>
          </tr>
          <tr>
            <td style="padding:4px 0;color:#6b7280;">Phone:</td>
            <td style="padding:4px 0;font-weight:600;color:#111827;">${e(formatted.customerPhone)}</td>
          </tr>
          <tr>
            <td style="padding:4px 0;color:#6b7280;">Email:</td>
            <td style="padding:4px 0;color:#111827;">${e(formatted.customerEmail)}</td>
          </tr>
          <tr>
            <td style="padding:4px 0;color:#6b7280;">Fulfillment:</td>
            <td style="padding:4px 0;font-weight:600;color:#111827;">${e(formatted.fulfillmentType)}</td>
          </tr>
          <tr>
            <td style="padding:4px 0;color:#6b7280;">Delivery Address:</td>
            <td style="padding:4px 0;color:#111827;">${e(formatted.shippingAddress)}</td>
          </tr>
          <tr>
            <td style="padding:4px 0;color:#6b7280;">Order Notes:</td>
            <td style="padding:4px 0;color:#111827;font-style:italic;">${e(formatted.notes)}</td>
          </tr>
        </table>

        <h3 style="margin:0 0 12px;font-size:15px;color:#374151;text-transform:uppercase;letter-spacing:0.5px;">Order Details</h3>
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;font-size:13px;border-collapse:collapse;">
          <thead>
            <tr style="background:#f3f4f6;">
              <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #e5e7eb;">Item</th>
              <th style="padding:8px 12px;text-align:center;border-bottom:2px solid #e5e7eb;">Qty</th>
              <th style="padding:8px 12px;text-align:right;border-bottom:2px solid #e5e7eb;">Price</th>
              <th style="padding:8px 12px;text-align:right;border-bottom:2px solid #e5e7eb;">Total</th>
            </tr>
          </thead>
          <tbody>
            ${itemsRows}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="3" style="padding:10px 12px 4px;text-align:right;color:#6b7280;">Subtotal:</td>
              <td style="padding:10px 12px 4px;text-align:right;font-weight:600;">ETB ${e(formatted.subtotalAmount)}</td>
            </tr>
            <tr>
              <td colspan="3" style="padding:4px 12px;text-align:right;color:#6b7280;">Tax (8%):</td>
              <td style="padding:4px 12px;text-align:right;font-weight:600;">ETB ${e(formatted.taxAmount)}</td>
            </tr>
            <tr>
              <td colspan="3" style="padding:4px 12px;text-align:right;color:#6b7280;">Delivery Fee:</td>
              <td style="padding:4px 12px;text-align:right;font-weight:600;">ETB ${e(formatted.deliveryFee)}</td>
            </tr>
            <tr style="font-size:15px;border-top:2px solid #e5e7eb;">
              <td colspan="3" style="padding:12px;text-align:right;font-weight:700;color:#111827;">Grand Total:</td>
              <td style="padding:12px;text-align:right;font-weight:700;color:#f97316;">ETB ${e(formatted.totalAmount)}</td>
            </tr>
          </tfoot>
        </table>
      </td>
    </tr>
    <tr>
      <td style="background:#f3f4f6;padding:16px 32px;font-size:12px;color:#6b7280;text-align:center;border-top:1px solid #e5e7eb;">
        Savora Express Restaurant Management • Addis Ababa, Ethiopia
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}

export async function sendTelegramNotification({
  order,
  eventType = 'NEW_ORDER',
  botToken = config.telegramBotToken || process.env.TELEGRAM_BOT_TOKEN,
  chatId = config.telegramChatId || process.env.TELEGRAM_CHAT_ID,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!botToken || !chatId) {
    return { sent: false, reason: 'Telegram bot token or chat ID is not configured' };
  }

  const formatted = formatOrderNotification(order, eventType);
  const text = buildTelegramMessage(formatted);
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
    }),
  });

  const responseData = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`Telegram API returned HTTP ${response.status}: ${JSON.stringify(responseData)}`);
  }

  return { sent: true, provider: 'telegram', messageId: responseData?.result?.message_id };
}

export async function sendEmailNotification({
  order,
  eventType = 'NEW_ORDER',
  toEmail = config.adminNotifyEmail || process.env.ADMIN_NOTIFY_EMAIL,
  smtpHost = config.smtpHost || process.env.SMTP_HOST,
  smtpPort = config.smtpPort || process.env.SMTP_PORT,
  smtpUser = config.smtpUser || process.env.SMTP_USER,
  smtpPass = config.smtpPass || process.env.SMTP_PASS,
  resendApiKey = config.resendApiKey || process.env.RESEND_API_KEY,
  transportOverride = null,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!toEmail) {
    return { sent: false, reason: 'ADMIN_NOTIFY_EMAIL is not configured' };
  }

  const formatted = formatOrderNotification(order, eventType);
  const subject = `[Savora Express] ${formatted.title} #${formatted.orderNumber}`;
  const html = buildEmailHtml(formatted);
  const text = `${formatted.title} #${formatted.orderNumber}\nTotal: ETB ${formatted.totalAmount}\nCustomer: ${formatted.customerName} (${formatted.customerPhone})\nFulfillment: ${formatted.fulfillmentType}\nAddress: ${formatted.shippingAddress}\nNotes: ${formatted.notes}`;

  // If a nodemailer transport is explicitly provided (e.g. In unit tests)
  if (transportOverride) {
    const info = await transportOverride.sendMail({
      from: '"Savora Express" <orders@savoraexpress.com>',
      to: toEmail,
      subject,
      text,
      html,
    });
    return { sent: true, provider: 'custom-transport', messageId: info?.messageId };
  }

  // If SMTP is configured
  if (smtpHost) {
    const port = Number(smtpPort || 587);
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port,
      secure: port === 465,
      auth: (smtpUser && smtpPass) ? { user: smtpUser, pass: smtpPass } : undefined,
    });

    const info = await transporter.sendMail({
      from: '"Savora Express" <orders@savoraexpress.com>',
      to: toEmail,
      subject,
      text,
      html,
    });
    return { sent: true, provider: 'smtp', messageId: info?.messageId };
  }

  // If Resend API is configured
  if (resendApiKey) {
    const response = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Savora Express <onboarding@resend.dev>',
        to: [toEmail],
        subject,
        html,
        text,
      }),
    });

    const resData = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(`Resend API returned HTTP ${response.status}: ${JSON.stringify(resData)}`);
    }
    return { sent: true, provider: 'resend', id: resData?.id };
  }

  return { sent: false, reason: 'No SMTP or Resend credentials configured' };
}

export async function notifyNewOrder(order, eventType = 'NEW_ORDER') {
  if (!order) {
    return { sent: false, reason: 'No order provided' };
  }

  try {
    const results = await Promise.allSettled([
      sendTelegramNotification({ order, eventType }),
      sendEmailNotification({ order, eventType }),
    ]);

    const telegram = results[0].status === 'fulfilled'
      ? results[0].value
      : { sent: false, error: results[0].reason?.message };

    const email = results[1].status === 'fulfilled'
      ? results[1].value
      : { sent: false, error: results[1].reason?.message };

    return {
      orderNumber: order.orderNumber || order.id,
      eventType,
      telegram,
      email,
    };
  } catch (error) {
    console.error('[notifications] Unexpected error during notification dispatch:', error?.message || error);
    return { sent: false, error: error?.message || 'Notification failure' };
  }
}
