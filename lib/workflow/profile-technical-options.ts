import {z} from "zod";
const uuid=z.string().uuid();
const list={profile_id:uuid,page:z.number().int().min(1).max(10000).default(1),search:z.string().trim().max(80).default("")};
export const technicalOptionCommandSchema=z.discriminatedUnion("command",[
  z.object({command:z.literal("options.list"),...list}).strict(),z.object({command:z.literal("catalog.list"),...list}).strict(),
  z.object({command:z.literal("option.create"),profile_id:uuid,id:uuid,alloy_id:uuid,temper_id:uuid}).strict(),
  z.object({command:z.enum(["option.approve","option.withdraw"]),profile_id:uuid,id:uuid}).strict()
]);
export const technicalSnapshotSchema=z.object({profile_id:uuid,profile_code:z.string(),section_weight_kg_per_m:z.number().positive(),perimeter_mm:z.number().nullable(),drawing_revision:z.string().nullable(),drawing_approval_status:z.string().nullable(),ccd_mm:z.number().nullable(),wall_thickness_mm:z.number().nullable(),standard_length_m:z.number().nullable(),alloy:z.string().optional(),temper:z.string().optional()}).strict();
export const technicalOptionsSchema=z.object({items:z.array(z.object({id:uuid,revision_number:z.number().int().positive(),status:z.enum(["draft","approved","withdrawn"]),snapshot:technicalSnapshotSchema,author_id:uuid,approved_by:uuid.nullable(),current_source:z.boolean()}).strict()),page:z.number().int(),eligible_count:z.number().int().nonnegative(),profile:technicalSnapshotSchema}).strict();
export type TechnicalOptions=z.infer<typeof technicalOptionsSchema>;
export const technicalCatalogSchema=z.object({alloys:z.array(z.object({id:uuid,value:z.string()}).strict()),tempers:z.array(z.object({id:uuid,value:z.string()}).strict()),page:z.number().int()}).strict();
export function soleTechnicalOption(data:TechnicalOptions){return data.eligible_count===1?data.items.find(option=>option.current_source&&option.status==="approved")??null:null;}
