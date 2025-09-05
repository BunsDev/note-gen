import { uploadImageByGithub } from "./github";
import { uploadImageBySmms } from "./smms";
import { uploadImageByPicgo } from "./picgo";
import { uploadImageByS3 } from "./s3";
import { Store } from "@tauri-apps/plugin-store";

export async function uploadImage(file: File) {
  const store = await Store.load('store.json');
  const mainImageHosting = await store.get('mainImageHosting') || 'github'
  switch (mainImageHosting) {
    case 'github':
      return uploadImageByGithub(file)
    case 'smms':
      return uploadImageBySmms(file)
    case 'picgo':
      return uploadImageByPicgo(file)
    case 's3':
      return uploadImageByS3(file)
    default:
      return undefined
  }
}