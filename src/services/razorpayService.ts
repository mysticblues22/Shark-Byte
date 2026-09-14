import { env } from "../config/env";

export interface CreatePaymentLinkOptions {
  amountInr: number;
  description: string;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  ticketId?: string;
  planName?: string;
  serviceType?: string;
}

export interface PaymentLinkResult {
  paymentLinkId: string;
  shortUrl: string;
  status: string;
  isMock: boolean;
}

export interface PaymentVerificationResult {
  isPaid: boolean;
  paymentId?: string;
  status: string;
  amountPaidInr?: number;
}

export async function createPaymentLink(options: CreatePaymentLinkOptions): Promise<PaymentLinkResult> {
  const keyId = env.RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY_ID;
  const keySecret = env.RAZORPAY_KEY_SECRET || process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    console.warn("⚠️ Razorpay API keys (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET) not set. Generating fallback simulated payment link.");
    const mockId = `plink_mock_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    return {
      paymentLinkId: mockId,
      shortUrl: `https://rzp.io/i/sharkbyte_${mockId.slice(-6)}`,
      status: "created",
      isMock: true,
    };
  }

  const authHeader = "Basic " + Buffer.from(`${keyId}:${keySecret}`).toString("base64");
  const amountInPaise = Math.round(options.amountInr * 100);

  const safeCustomerName = (options.customerName || "Customer").replace(/[^a-zA-Z0-9 space._-]/g, "").trim() || "Customer";

  const payload = {
    amount: amountInPaise,
    currency: "INR",
    accept_partial: false,
    description: options.description,
    customer: {
      name: safeCustomerName,
      email: options.customerEmail || "customer@sharkbyte.com",
      contact: options.customerPhone || "+919876543210",
    },
    notify: {
      sms: false,
      email: false,
    },
    reminder_enable: false,
    notes: {
      ticket_id: options.ticketId || "",
      service_type: options.serviceType || "hosting",
      plan_name: options.planName || "",
    },
  };

  const response = await fetch("https://api.razorpay.com/v1/payment_links", {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Razorpay API Error (${response.status}): ${errText}`);
  }

  const data: any = await response.json();
  return {
    paymentLinkId: data.id,
    shortUrl: data.short_url,
    status: data.status,
    isMock: false,
  };
}

export async function verifyPaymentLinkStatus(paymentLinkId: string): Promise<PaymentVerificationResult> {
  const keyId = env.RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY_ID;
  const keySecret = env.RAZORPAY_KEY_SECRET || process.env.RAZORPAY_KEY_SECRET;

  if (paymentLinkId.startsWith("plink_mock_") || !keyId || !keySecret) {
    // Simulated payment verification for testing environments
    return {
      isPaid: true,
      paymentId: `pay_mock_${Date.now()}`,
      status: "paid",
      amountPaidInr: 199.0,
    };
  }

  const authHeader = "Basic " + Buffer.from(`${keyId}:${keySecret}`).toString("base64");
  const response = await fetch(`https://api.razorpay.com/v1/payment_links/${paymentLinkId}`, {
    method: "GET",
    headers: {
      Authorization: authHeader,
    },
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Razorpay Verification Error (${response.status}): ${errText}`);
  }

  const data: any = await response.json();
  const isPaid = data.status === "paid";
  const payments = data.payments || [];
  const lastPayment = payments.length > 0 ? payments[payments.length - 1] : null;

  return {
    isPaid,
    paymentId: lastPayment ? lastPayment.payment_id : data.id,
    status: data.status,
    amountPaidInr: data.amount_paid ? data.amount_paid / 100 : undefined,
  };
}
