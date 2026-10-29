import { z } from "zod";
export const mobileBundleQueueSchema=z.object({page:z.coerce.number().int().min(1).max(10000).default(1),search:z.string().trim().max(80).default("")}).strict();
export function canRecordMobileBundle(role:string,dealerId:string|null|undefined){return !dealerId&&["owner","admin","factory_manager","dispatch_manager","dispatch","inventory_manager"].includes(role);}
export function parseBundleObservationText(value:string,whole=false){
  if(!(whole?/^\d+$/:/^\d+(?:\.\d{1,3})?$/).test(value.trim()))return NaN;
  const number=Number(value.trim());return Number.isFinite(number)&&number<=1000000?number:NaN;
}
