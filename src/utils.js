const generateFilters = (profile) => {
  let filters = {};
  if (profile.type === "client") {
    filters.ClientId = profile.id;
  } else if (profile.type === "contractor") {
    filters.ContractorId = profile.id;
  }
  return filters;
};

module.exports = generateFilters;
