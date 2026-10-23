import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import type pg from "pg";
import { config } from "./config.js";
import { AppError, errorBody } from "./errors.js";
import { verifyWebhookSignature } from "./hmac.js";
import { listProducts } from "./inventory.js";
import { createOrder, getOrder } from "./order-service.js";
import { claimPickup } from "./pickup-service.js";
import { processWebhook } from "./webhook-service.js";

export function createApp(pool: pg.Pool) {
  const app = express();
  app.use(cors());

  app.get("/health", async (_req, res, next) => {
    try {
      await pool.query("SELECT 1");
      res.json({ status: "ok" });
    } catch (error) {
      next(error);
    }
  });

  app.post("/payments/webhook", express.raw({ type: "application/json" }), async (req, res, next) => {
    try {
      const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body ?? ""), "utf8");
      if (!verifyWebhookSignature(rawBody, req.header("X-Signature"), config.webhookSecret)) {
        res.status(401).json(errorBody("INVALID_SIGNATURE", "Webhook signature is missing or invalid."));
        return;
      }
      let payload: unknown;
      try {
        payload = JSON.parse(rawBody.toString("utf8"));
      } catch {
        throw new AppError(400, "INVALID_WEBHOOK", "Webhook body must be valid JSON.");
      }
      const result = await processWebhook(pool, payload);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  });

  app.use(express.json());

  app.get("/products", async (_req, res, next) => {
    try {
      res.json({ products: await listProducts(pool) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/orders", async (req, res, next) => {
    try {
      const order = await createOrder(pool, req.body);
      res.status(201).json({ order });
    } catch (error) {
      next(error);
    }
  });

  app.get("/orders/:id", async (req, res, next) => {
    try {
      const order = await getOrder(pool, req.params.id);
      res.json({ order });
    } catch (error) {
      next(error);
    }
  });

  app.post("/orders/:id/pickup-claim", async (req, res, next) => {
    try {
      const order = await claimPickup(pool, req.params.id);
      res.json({ order });
    } catch (error) {
      next(error);
    }
  });

  app.post("/dev/simulate-payment", async (req, res, next) => {
    try {
      const { orderId, amountPaise, status = "captured" } = req.body as {
        orderId: string;
        amountPaise?: number;
        status?: string;
      };
      let amount = amountPaise;
      if (amount === undefined) {
        const order = await getOrder(pool, orderId);
        amount = order.totalPaise;
      }
      const payload = {
        eventId: `evt_ui_${crypto.randomUUID()}`,
        orderId,
        amountPaise: amount,
        status,
      };
      const result = await processWebhook(pool, payload);
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.use((_req, res) => {
    res.status(404).json(errorBody("NOT_FOUND", "Route not found."));
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof AppError) {
      res.status(error.statusCode).json(errorBody(error.code, error.message));
      return;
    }
    console.error(error);
    res.status(500).json(errorBody("INTERNAL_ERROR", "An unexpected error occurred."));
  });

  return app;
}
