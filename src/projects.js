// Keep links to the original root-hosted ear sections working.
const earSections=new Set(['#experiment','#experiment-title','#shape','#shape-title','#method-title']);
if(earSections.has(window.location.hash)){
  window.location.replace(`/ear/${window.location.search}${window.location.hash}`);
}
