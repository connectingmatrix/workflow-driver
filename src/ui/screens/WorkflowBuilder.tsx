import { Plus, Sparkles, Database, Users, FileText, BookOpen, Zap, List } from 'lucide-react';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { useNavigate } from 'react-router';
import { createWorkflow } from '@/dataloaders';
import { useUiDataContext } from "../contexts/AuthSessionContext";
import { useToast } from '../components/Toast';

interface WorkflowTemplate {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
}

export default function WorkflowBuilder() {
  const context = useUiDataContext();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const templates: WorkflowTemplate[] = [
    {
      id: 'data-enrichment',
      title: 'Data enrichment',
      description: 'Pull together data to answer user questions',
      icon: <Database className="w-5 h-5" />,
    },
    {
      id: 'planning-helper',
      title: 'Planning helper',
      description: 'Simple multi-turn workflow for creating task plans',
      icon: <FileText className="w-5 h-5" />,
    },
    {
      id: 'customer-service',
      title: 'Customer service',
      description: 'Resolve customer queries with custom policies',
      icon: <Users className="w-5 h-5" />,
    },
    {
      id: 'structured-qa',
      title: 'Structured Data Q/A',
      description: 'Query databases using natural language',
      icon: <Zap className="w-5 h-5" />,
    },
    {
      id: 'document-comparison',
      title: 'Document comparison',
      description: 'Analyze and highlight differences across uploaded documents',
      icon: <FileText className="w-5 h-5" />,
    },
    {
      id: 'knowledge-assistant',
      title: 'Internal knowledge assistant',
      description: 'Triage and answer questions from employees',
      icon: <BookOpen className="w-5 h-5" />,
    },
  ];

  const handleCreate = async (title: string, description: string, templateId: string) => {
    const workflow = await createWorkflow(context, {
      title,
      slug: title.trim().toLowerCase().replace(/\s+/g, '-'),
      description,
      data: { templateId, nodes: [] },
    });
    showToast('success', 'Workflow created');
    navigate(`/workflow-editor?id=${workflow.id}`);
  };

  return (
    <div className="min-h-screen bg-background dark:bg-[#0a0a0a]">
      {/* Top Bar */}
      <div className="border-b border-border dark:border-[#2a2a2a] bg-white dark:bg-[#0f0f0f]">
        <div className="max-w-7xl mx-auto px-8 py-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold dark:text-gray-100">Workflow Builder</h2>
          <Button variant="secondary" size="sm" onClick={() => navigate('/workflows')} className="gap-2">
            <List className="w-4 h-4" />
            View All Workflows
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-8 py-12">
        {/* Header */}
        <div className="text-center mb-16">
          <h1 className="text-4xl font-bold mb-3 dark:text-gray-100">
            Create a workflow
          </h1>
          <p className="text-lg text-muted-foreground dark:text-gray-400 mb-8">
            Build a chat agent workflow with custom logic and tools
          </p>
          <Button size="lg" className="gap-2" onClick={() => handleCreate('Untitled workflow', 'Workflow created from scratch', 'blank')}>
            <Plus className="w-5 h-5" />
            Create
          </Button>
        </div>

        {/* Templates Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {templates.map((template) => (
            <Card
              key={template.id}
              className="group hover:border-primary/50 dark:hover:border-primary/50 transition-all cursor-pointer"
              onClick={() => handleCreate(template.title, template.description, template.id)}
            >
              <div className="space-y-4">
                {/* Icon */}
                <div className="w-12 h-12 rounded-lg bg-yellow-100 dark:bg-yellow-900/30 flex items-center justify-center text-yellow-600 dark:text-yellow-500">
                  {template.icon}
                </div>

                {/* Content */}
                <div>
                  <h3 className="font-semibold mb-2 dark:text-gray-100 group-hover:text-primary dark:group-hover:text-primary transition-colors">
                    {template.title}
                  </h3>
                  <p className="text-sm text-muted-foreground dark:text-gray-400 leading-relaxed">
                    {template.description}
                  </p>
                </div>

                {/* Template Label */}
                <div className="pt-2 border-t border-border dark:border-[#2a2a2a]">
                  <span className="text-xs text-muted-foreground dark:text-gray-500">
                    Template
                  </span>
                </div>
              </div>
            </Card>
          ))}
        </div>

        {/* Empty State Hint */}
        <div className="mt-16 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-3 bg-primary/5 dark:bg-primary/10 border border-primary/20 dark:border-primary/20 rounded-lg">
            <Sparkles className="w-4 h-4 text-primary" />
            <p className="text-sm text-muted-foreground dark:text-gray-400">
              Choose a template to get started, or create a workflow from scratch
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
