import express, {
  type ErrorRequestHandler,
  type Express,
  type RequestHandler,
} from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { isTrustedBrowserOrigin } from "./lib/signal-runtime";

const app: Express = express();
// Honor forwarded client addresses only when the deployment explicitly says a
// trusted reverse proxy is in front of this process.
app.set("trust proxy", process.env.TRUST_PROXY === "true" ? 1 : false);
app.disable("x-powered-by");

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

const corsOptions: cors.CorsOptions = {
  origin(origin, callback) {
    // Requests without Origin include same-origin navigations and scripted
    // integration checks. Browser origins must be an explicit public origin,
    // or loopback while DEMO_MODE is enabled.
    callback(null, !origin || isTrustedBrowserOrigin(origin));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
};
app.use(cors(corsOptions));

const securityHeaders: RequestHandler = (_req, res, next) => {
  res.set({
    "Cache-Control": "no-store",
    "Cross-Origin-Resource-Policy": "same-site",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  });
  next();
};
app.use(securityHeaders);

const originGuard: RequestHandler = (req, res, next) => {
  if (
    ["POST", "PUT", "PATCH", "DELETE"].includes(req.method) &&
    req.headers.origin &&
    !isTrustedBrowserOrigin(req.headers.origin)
  ) {
    res.status(403).json({ error: "Запрос отклонён политикой источника." });
    return;
  }
  next();
};
app.use(originGuard);
app.use(cookieParser());
// Only the bounded raster-avatar endpoint accepts a larger body.
app.use('/api/me/avatar', express.json({ limit: '3mb' }));
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false, limit: "100kb" }));

app.use("/api", router);

const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  const malformedJson = error instanceof SyntaxError && "body" in error;
  logger.warn({ errorType: error.name }, "API request failed before routing");
  res.status(malformedJson ? 400 : 500).json({
    error: malformedJson
      ? "Некорректный JSON в запросе."
      : "Не удалось обработать запрос. Попробуйте позже.",
  });
};
app.use(errorHandler);

export default app;
