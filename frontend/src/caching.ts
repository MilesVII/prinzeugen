
// async function manualCache(){
// 	pullCurtain(true);
	
// 	const status = await callAPI("linkCache", {}, true);
// 	if (status.status != 200){
// 		console.error(status);
// 		pullCurtain(false);
// 		return;
// 	}

// 	let counter = 0;
// 	const targets = status.data.leftUncached;
// 	for (let target of targets){
// 		updateCurtainMessage(`Downloading images: ${counter} / ${targets.length} done`);
// 		++counter;
		
// 		const r = await callAPI("downloadCache", {
// 			id: target.id
// 		}, true);
// 		if (r.status != 201)
// 			console.warn(r);
// 	}

// 	const newStatus = await callAPI("linkCache", {}, true);
// 	report(`Caching complete. ${newStatus.data?.leftUncached?.length} left uncached.`);
// 	console.log(newStatus);

// 	updateCurtainMessage(`Updating moderables`);
// 	await reloadModerables(false);

// 	pullCurtain(false);
// }