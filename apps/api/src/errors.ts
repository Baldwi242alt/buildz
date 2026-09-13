import { Catch, type ExceptionFilter, type ArgumentsHost, HttpException } from '@nestjs/common';
import type { Request, Response } from 'express';
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export const missing = () => new ApiError(404,'NOT_FOUND','This record is unavailable.');
export const forbidden = () => new ApiError(403,'CAPABILITY_DENIED','You cannot perform this action.');
export const conflict = (code='VERSION_CONFLICT', message='The record changed. Refresh and try again.') => new ApiError(409,code,message);

@Catch()
export class ErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    let e = exception instanceof ApiError ? exception : undefined;
    const dbCode = typeof exception === 'object' && exception ? (exception as { code?: string }).code : undefined;
    const parseType=typeof exception==='object'&&exception?(exception as {type?:string}).type:undefined;
    if(!e&&parseType==='entity.parse.failed')e=new ApiError(400,'INVALID_JSON','The JSON request body is malformed.');
    if(!e&&parseType==='entity.too.large')e=new ApiError(413,'BODY_TOO_LARGE','The request body is too large.');
    if (!e && dbCode === '23505') e = conflict('ALREADY_EXISTS','An active record already exists.');
    if (!e && dbCode === '23P01') e = conflict('SLOT_UNAVAILABLE','This time has already been reserved.');
    if (!e && ['40001','40P01'].includes(dbCode??'')) e = conflict('RETRY_TRANSACTION','A simultaneous change occurred. Retry with the same idempotency key.');
    if (!e && dbCode === '42501') e = forbidden();
    if (!e && ['23503','23514'].includes(dbCode ?? '')) e = new ApiError(422,'INVALID_RELATIONSHIP','This change violates an active relationship.');
    if (!e && exception instanceof HttpException) e = new ApiError(exception.getStatus(), 'REQUEST_REJECTED', exception.getStatus()===404?'Route not found.':'Request rejected.');
    if (!e) {
      console.error(JSON.stringify({ requestId: res.locals.requestId, event: 'request.failed', errorType: exception instanceof Error ? exception.name : 'unknown' }));
      e = new ApiError(500,'INTERNAL_ERROR','An unexpected error occurred.');
    }
    res.status(e.status).json({ error: { code:e.code, message:e.message, retryable:e.status>=500,
      requestId:res.locals.requestId ?? 'unknown' } });
    void req;
  }
}
