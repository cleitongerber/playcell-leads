import { createTRPCReact } from "@trpc/react-query";
import type { V2FoundationRouter } from "../../../server/v2/router";

export const v2trpc = createTRPCReact<V2FoundationRouter>();
