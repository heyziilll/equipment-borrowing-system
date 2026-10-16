export const borrowerRoles = ["student", "faculty"];
export const staffRoles = ["custodian", "administrator"];

export function canBorrow(role) {
  return borrowerRoles.includes(role);
}

export function canManageInventory(role) {
  return staffRoles.includes(role);
}

export function equipmentStatusClass(status) {
  const classes = {
    Available: "bg-emerald-50 text-emerald-800",
    Reserved: "bg-amber-50 text-amber-800",
    "Checked Out": "bg-blue-50 text-blue-800",
    "Under Maintenance": "bg-orange-50 text-orange-800",
    Lost: "bg-red-50 text-red-800"
  };
  return classes[status] || "bg-slate-100 text-slate-700";
}

export function csvUrl(type) {
  return `/reports/${type}/csv`;
}
