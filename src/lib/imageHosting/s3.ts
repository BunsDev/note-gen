import { Store } from "@tauri-apps/plugin-store";
import { fetch, Proxy } from '@tauri-apps/plugin-http'
import { toast } from '@/hooks/use-toast';
import { v4 as uuid } from 'uuid';

interface S3Config {
  accessKeyId: string
  secretAccessKey: string
  region: string
  bucket: string
  endpoint?: string
  customDomain?: string
  pathPrefix?: string
}

// 生成 AWS 签名 V4 (使用 Web Crypto API)
async function generateSignature(
  method: string,
  url: string,
  headers: Record<string, string>,
  payload: ArrayBuffer,
  config: S3Config
) {
  const algorithm = 'AWS4-HMAC-SHA256';
  const date = new Date();
  const dateStamp = date.toISOString().slice(0, 10).replace(/-/g, '');
  const amzDate = date.toISOString().replace(/[:\-]|\.\d{3}/g, '');
  
  // 创建规范请求
  const canonicalUri = new URL(url).pathname;
  const canonicalQuerystring = '';
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map(key => `${key.toLowerCase()}:${headers[key]}\n`)
    .join('');
  const signedHeaders = Object.keys(headers)
    .sort()
    .map(key => key.toLowerCase())
    .join(';');
  
  // 使用 Web Crypto API 计算 SHA256
  const payloadHash = await crypto.subtle.digest('SHA-256', payload);
  const payloadHashHex = Array.from(new Uint8Array(payloadHash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  
  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuerystring,
    canonicalHeaders,
    signedHeaders,
    payloadHashHex
  ].join('\n');
  
  // 创建字符串以供签名
  const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const stringToSign = [
    algorithm,
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest)
  ].join('\n');
  
  // 计算签名
  const signingKey = await getSignatureKey(config.secretAccessKey, dateStamp, config.region, 's3');
  const signature = await hmacSha256Hex(signingKey, stringToSign);
  
  return {
    authorization: `${algorithm} Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    amzDate,
    payloadHashHex
  };
}

// Web Crypto API 辅助函数
async function sha256Hex(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(data));
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hmacSha256(key: CryptoKey, data: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  return await crypto.subtle.sign('HMAC', key, encoder.encode(data));
}

async function hmacSha256Hex(key: CryptoKey, data: string): Promise<string> {
  const signature = await hmacSha256(key, data);
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function getSignatureKey(key: string, dateStamp: string, regionName: string, serviceName: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  
  // 导入初始密钥
  const kSecret = await crypto.subtle.importKey(
    'raw',
    encoder.encode('AWS4' + key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  // kDate = HMAC("AWS4" + kSecret, Date)
  const kDate = await crypto.subtle.sign('HMAC', kSecret, encoder.encode(dateStamp));
  const kDateKey = await crypto.subtle.importKey(
    'raw',
    kDate,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  // kRegion = HMAC(kDate, Region)
  const kRegion = await crypto.subtle.sign('HMAC', kDateKey, encoder.encode(regionName));
  const kRegionKey = await crypto.subtle.importKey(
    'raw',
    kRegion,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  // kService = HMAC(kRegion, Service)
  const kService = await crypto.subtle.sign('HMAC', kRegionKey, encoder.encode(serviceName));
  const kServiceKey = await crypto.subtle.importKey(
    'raw',
    kService,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  // kSigning = HMAC(kService, "aws4_request")
  const kSigning = await crypto.subtle.sign('HMAC', kServiceKey, encoder.encode('aws4_request'));
  return await crypto.subtle.importKey(
    'raw',
    kSigning,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

// 测试 S3 连接
export async function testS3Connection(config: S3Config): Promise<boolean> {
  try {
    const store = await Store.load('store.json');
    const proxyUrl = await store.get<string>('proxy')
    const proxy: Proxy | undefined = proxyUrl ? { all: proxyUrl } : undefined

    const endpoint = config.endpoint || `https://s3.${config.region}.amazonaws.com`;
    const url = `${endpoint}/${config.bucket}`;
    
    const emptyPayload = new ArrayBuffer(0);
    const payloadHash = await crypto.subtle.digest('SHA-256', emptyPayload);
    const payloadHashHex = Array.from(new Uint8Array(payloadHash))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    
    const headers = {
      'Host': new URL(url).host,
      'X-Amz-Content-Sha256': payloadHashHex
    };
    
    const { authorization, amzDate } = await generateSignature('HEAD', url, headers, emptyPayload, config);
    
    const requestHeaders = new Headers();
    requestHeaders.append('Authorization', authorization);
    requestHeaders.append('X-Amz-Date', amzDate);
    requestHeaders.append('X-Amz-Content-Sha256', payloadHashHex);
    
    const response = await fetch(url, {
      method: 'HEAD',
      headers: requestHeaders,
      proxy
    });

    if (response.status !== 200) {
      const errorText = await response.text();
      console.error('S3 Error Response:', errorText);
    }
    
    return response.status === 200;
  } catch (error) {
    console.error('S3 connection test failed:', error);
    return false;
  }
}

// 上传图片到 S3
export async function uploadImageByS3(file: File): Promise<string | undefined> {
  try {
    const store = await Store.load('store.json');
    const config = await store.get<S3Config>('s3Config');
    
    if (!config) {
      toast({
        title: 'S3 配置错误',
        description: '请先配置 S3 参数',
        variant: 'destructive',
      });
      return undefined;
    }
    
    const proxyUrl = await store.get<string>('proxy')
    const proxy: Proxy | undefined = proxyUrl ? { all: proxyUrl } : undefined

    // 生成文件名
    const id = uuid();
    const ext = file.name.split('.').pop() || 'jpg';
    const filename = `${id}.${ext}`.replace(/\s/g, '_');
    const key = config.pathPrefix ? `${config.pathPrefix}/${filename}` : filename;
    
    // 准备上传
    const endpoint = config.endpoint || `https://s3.${config.region}.amazonaws.com`;
    const url = `${endpoint}/${config.bucket}/${key}`;
    
    // 读取文件内容
    const arrayBuffer = await file.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    
    const headers = {
      'Host': new URL(url).host,
      'Content-Type': file.type || 'application/octet-stream',
      'Content-Length': file.size.toString()
    };
    
    const { authorization, amzDate, payloadHashHex } = await generateSignature('PUT', url, headers, arrayBuffer, config);
    
    const requestHeaders = new Headers();
    requestHeaders.append('Authorization', authorization);
    requestHeaders.append('X-Amz-Date', amzDate);
    requestHeaders.append('Content-Type', file.type || 'application/octet-stream');
    requestHeaders.append('X-Amz-Content-Sha256', payloadHashHex);
    
    const response = await fetch(url, {
      method: 'PUT',
      headers: requestHeaders,
      body: uint8Array,
      proxy
    });
    
    if (response.status === 200 || response.status === 204) {
      // 返回访问 URL
      if (config.customDomain) {
        return `${config.customDomain}/${key}`;
      } else {
        return `${endpoint}/${config.bucket}/${key}`;
      }
    } else {
      const errorText = await response.text();
      throw new Error(`Upload failed: ${response.status} ${errorText}`);
    }
    
  } catch (error) {
    toast({
      title: '上传失败',
      description: (error as Error).message,
      variant: 'destructive',
    });
    return undefined;
  }
}
