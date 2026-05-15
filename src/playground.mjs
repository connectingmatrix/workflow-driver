import { Workflows } from './index.js'; const w=Workflows.create({name:'demo'}); console.log(await Workflows.execute(w.id));
