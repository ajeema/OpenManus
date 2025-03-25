
from typing import Dict, Any, Optional
from app.tool.base import BaseTool, ToolResult

class OutputGeneratorTool(BaseTool):
    name: str = "output_generator"
    description: str = "Generates formatted output for user responses"
    parameters: Dict = {
        "type": "object",
        "properties": {
            "content": {
                "type": "string",
                "description": "The content to be formatted"
            },
            "format": {
                "type": "string",
                "enum": ["text", "json", "markdown"],
                "description": "The output format"
            }
        },
        "required": ["content"]
    }

    async def execute(self, content: str, format: Optional[str] = "text") -> ToolResult:
        """Execute the output generation."""
        try:
            # Basic formatting based on type
            if format == "json":
                return ToolResult(output={"content": content})
            elif format == "markdown":
                return ToolResult(output=f"```markdown\n{content}\n```")
            else:
                return ToolResult(output=content)
        except Exception as e:
            return ToolResult(output=f"Error generating output: {str(e)}")
