export const projectStatuses = ["draft","calculated","quoted","approved","converted_to_order","in_production","completed","cancelled","sent","ordered","archived"] as const;
export const projectSystemTypes = ["two_track_sliding_window","three_track_sliding_window","sliding_door","casement_window","fixed_window","top_hung_window","hinged_door","swing_door","partition","ventilator","combination","custom"] as const;
export const projectSortColumns = ["created_at","configuration_number","project_name","status"] as const;

export function getProjectListOptions(params: Record<string, string | string[] | undefined>) {
  const value = (name: string) => { const raw = params[name]; return typeof raw === "string" ? raw : ""; };
  const numericPage = Number(value("page") || 1);
  const page = Number.isSafeInteger(numericPage) && numericPage > 0 ? Math.min(numericPage,100000) : 1;
  const search = value("q").replace(/[%*_,().]/g," ").replace(/\s+/g," ").trim().slice(0,100);
  const status = (projectStatuses as readonly string[]).includes(value("status")) ? value("status") : "";
  const systemType = (projectSystemTypes as readonly string[]).includes(value("system")) ? value("system") : "";
  const sort = (projectSortColumns as readonly string[]).includes(value("sort")) ? value("sort") : "created_at";
  const direction = value("direction") === "asc" ? "asc" : "desc";
  return { page,search,status,systemType,sort,direction,from:(page-1)*10,to:page*10-1 };
}

export function buildProjectListQuery(client: any, companyId: string, options: ReturnType<typeof getProjectListOptions>) {
  let query = client.from("system_configurations_authorized")
    .select("id,customer_id,configuration_number,project_name,design_reference,location_label,width_mm,height_mm,quantity,system_type,status,grand_total,created_at,system_series(series_code,series_name),customers(customer_name,company_name)",{count:"exact"})
    .eq("company_id",companyId);
  if (options.search) query = query.or(["configuration_number","project_name","design_reference","location_label"].map((column)=>`${column}.ilike.*${options.search}*`).join(","));
  if (options.status) query = query.eq("status",options.status);
  if (options.systemType) query = query.eq("system_type",options.systemType);
  return query.order(options.sort,{ascending:options.direction === "asc",nullsFirst:false}).order("id",{ascending:true}).range(options.from,options.to);
}
