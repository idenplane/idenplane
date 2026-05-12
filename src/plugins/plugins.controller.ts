import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiSecurity,
  ApiResponse,
} from '@nestjs/swagger';
import { PluginManagerService } from './plugin-manager.service.js';

@ApiTags('Plugins')
@Controller('admin/plugins')
@ApiSecurity('admin-api-key')
export class PluginsController {
  constructor(private readonly pluginManager: PluginManagerService) {}

  @Get()
  @ApiOperation({ summary: 'List all installed plugins' })
  @ApiResponse({
    status: 200,
    description: 'Array of installed plugin descriptors',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — missing or invalid admin API key',
  })
  async list() {
    try {
      return await this.pluginManager.listPlugins();
    } catch {
      // If the plugin subsystem failed to initialise (e.g. no plugins directory),
      // return an empty list rather than a 500 so the admin UI stays functional.
      return [];
    }
  }

  @Get(':name')
  @ApiOperation({ summary: 'Get details for a specific plugin' })
  @ApiResponse({ status: 200, description: 'Plugin descriptor' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — missing or invalid admin API key',
  })
  @ApiResponse({ status: 404, description: 'Plugin not found' })
  getOne(@Param('name') name: string) {
    return this.pluginManager.getPlugin(name);
  }

  @Post(':name/enable')
  @ApiOperation({ summary: 'Enable a plugin' })
  @ApiResponse({ status: 201, description: 'Plugin enabled' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — missing or invalid admin API key',
  })
  @ApiResponse({ status: 404, description: 'Plugin not found' })
  enable(@Param('name') name: string) {
    return this.pluginManager.enablePlugin(name);
  }

  @Post(':name/disable')
  @ApiOperation({ summary: 'Disable a plugin' })
  @ApiResponse({ status: 201, description: 'Plugin disabled' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — missing or invalid admin API key',
  })
  @ApiResponse({ status: 404, description: 'Plugin not found' })
  disable(@Param('name') name: string) {
    return this.pluginManager.disablePlugin(name);
  }

  @Delete(':name')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Uninstall a plugin' })
  @ApiResponse({ status: 204, description: 'Plugin uninstalled' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — missing or invalid admin API key',
  })
  @ApiResponse({ status: 404, description: 'Plugin not found' })
  async remove(@Param('name') name: string): Promise<void> {
    await this.pluginManager.uninstallPlugin(name);
  }
}
